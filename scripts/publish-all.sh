#!/usr/bin/env bash
# Publish every public @place-ts/* workspace package to npm. The full
# release flow — pre-flight survey, confirmation, prep-publish rewrite,
# dependency-ordered npm publish, final summary. Designed to be run
# whenever you've stacked patch / minor bumps and want to ship them.
#
# Usage:
#   bun run release                          # interactive (recommended)
#   bash scripts/publish-all.sh              # same thing
#   bash scripts/publish-all.sh --yes        # skip confirmation
#   bash scripts/publish-all.sh --dry-run    # show plan + pack, no upload
#   bash scripts/publish-all.sh --tag        # git tag + push after publish
#   bash scripts/publish-all.sh --otp 123456 # pass a TOTP code (npm 2FA)
#   OTP=123456 bun run release               # same, via env var
#
# Pre-requisites:
#   - logged into npm (`npm whoami` returns your user)
#   - if your account has 2FA on, either: (a) generate a one-time password
#     from your authenticator app and pass it via --otp / OTP env var
#     (npm caches it for ~5min, enough for one batched release); or
#     (b) put an automation access token in ~/.npmrc — those bypass 2FA
#     and are the right answer for repeated use.
#   - each package's version in its package.json is the version you want
#     to publish (use `prep-publish` script if you've changed
#     `workspace:*` deps and don't want to commit them rewritten)

set -e
set -u
set -o pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

# Parse flags. All optional; default flow is interactive.
DRY_RUN=0
SKIP_CONFIRM=0
TAG_RELEASES=0
OTP="${OTP:-}"  # env-var fallback; CLI flag overrides
EXPECT_OTP_VALUE=0
for arg in "$@"; do
  if [[ $EXPECT_OTP_VALUE -eq 1 ]]; then
    OTP="$arg"
    EXPECT_OTP_VALUE=0
    continue
  fi
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) SKIP_CONFIRM=1 ;;
    --tag) TAG_RELEASES=1 ;;
    --otp) EXPECT_OTP_VALUE=1 ;;
    --otp=*) OTP="${arg#--otp=}" ;;
    -h|--help)
      sed -n '1,/^set -e/p' "$0" | sed -n 's/^# \?//p' | head -30
      exit 0
      ;;
    *)
      echo "unknown flag: $arg (use --help)"
      exit 2
      ;;
  esac
done
if [[ $EXPECT_OTP_VALUE -eq 1 ]]; then
  echo "--otp requires a code argument (e.g. --otp 123456)"
  exit 2
fi

# Publish order: deps before dependents.
PACKAGES=(
  capability
  reactivity
  routing
  security
  data
  persistence
  search
  component
  design
  devtools
)
TOOLS=(
  place
  create-app
)

# Colors. Quiet down when stdout isn't a TTY.
if [[ -t 1 ]]; then
  C_DIM='\033[2m'; C_BOLD='\033[1m'; C_RED='\033[31m'; C_GREEN='\033[32m'
  C_YELLOW='\033[33m'; C_CYAN='\033[36m'; C_GRAY='\033[90m'; C_RESET='\033[0m'
else
  C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''; C_GRAY=''; C_RESET=''
fi

revert() {
  # 1. Remove tarballs left by `bun pm pack` (only happens in dry-run;
  #    real `npm publish` cleans up after itself).
  for d in capability component data design devtools persistence reactivity routing search security; do
    rm -f "$REPO/systems/$d"/place-ts-*.tgz 2>/dev/null
  done
  for d in place create-app; do
    rm -f "$REPO/tools/$d"/place-ts-*.tgz 2>/dev/null
  done
  # 2. If the in-place workspace:* rewrites were applied, revert them
  #    so the working tree stays clean on exit (success or failure).
  if (cd "$REPO" && git diff --quiet -- systems tools 2>/dev/null); then
    return 0
  fi
  echo
  printf "${C_DIM}↻ reverting in-place workspace:* rewrites${C_RESET}\n"
  (cd "$REPO" && git checkout -- systems tools 2>/dev/null) || true
}
trap revert EXIT INT TERM

# ===== Helpers =====

# Returns the version currently published on the registry, or "" if the
# package has never been published. Stderr is quiet so the script's own
# output stays scannable.
published_version() {
  npm view "$1" version 2>/dev/null || true
}

# Read a package.json field. `node -p` would fail on missing files; we
# guard with a fallback so unmatched packages render as "(missing)".
read_pkg_field() {
  local pkg_dir="$1" field="$2"
  if [[ ! -f "$pkg_dir/package.json" ]]; then
    echo ""
    return
  fi
  node -p "require('$pkg_dir/package.json').$field || ''"
}

# Collect every package's name + local version + registry version + plan
# (publish / skip / missing). One pass; we print the survey, then re-use
# the same data during the actual publish loop.
declare -a SURVEY_NAME=()
declare -a SURVEY_LOCAL=()
declare -a SURVEY_REGISTRY=()
declare -a SURVEY_PLAN=()
declare -a SURVEY_DIR=()

survey_package() {
  local pkg_dir="$1"
  if [[ ! -d "$pkg_dir" ]]; then return; fi
  local name local_v registry_v plan is_private
  name=$(read_pkg_field "$pkg_dir" name)
  local_v=$(read_pkg_field "$pkg_dir" version)
  is_private=$(read_pkg_field "$pkg_dir" private)
  # Silently skip private packages — they're workspace-only by design
  # (e.g. tools/place is a private diagnostics CLI; tools/site is an
  # internal example). The registry would reject `npm publish` on them
  # anyway, but excluding them up-front keeps the survey clean.
  if [[ "$is_private" == "true" ]]; then return; fi
  if [[ -z "$name" || -z "$local_v" ]]; then
    SURVEY_NAME+=("(unknown)")
    SURVEY_LOCAL+=("?")
    SURVEY_REGISTRY+=("?")
    SURVEY_PLAN+=("missing")
    SURVEY_DIR+=("$pkg_dir")
    return
  fi
  registry_v=$(published_version "$name")
  if [[ -z "$registry_v" ]]; then
    plan="publish-new"
  elif [[ "$registry_v" == "$local_v" ]]; then
    plan="skip"
  else
    plan="publish"
  fi
  SURVEY_NAME+=("$name")
  SURVEY_LOCAL+=("$local_v")
  SURVEY_REGISTRY+=("$registry_v")
  SURVEY_PLAN+=("$plan")
  SURVEY_DIR+=("$pkg_dir")
}

# ===== 1. Survey =====
printf "${C_BOLD}▶ Surveying npm registry…${C_RESET}\n"
for d in "${PACKAGES[@]}"; do survey_package "$REPO/systems/$d"; done
for d in "${TOOLS[@]}"; do survey_package "$REPO/tools/$d"; done

# Print the survey table.
echo
printf "${C_BOLD}Package${C_RESET}                          ${C_BOLD}Local${C_RESET}     ${C_BOLD}Registry${C_RESET}      ${C_BOLD}Plan${C_RESET}\n"
printf "${C_GRAY}%s${C_RESET}\n" "─────────────────────────────────────────────────────────────────────────────"
TO_PUBLISH=0
TO_SKIP=0
for i in "${!SURVEY_NAME[@]}"; do
  name="${SURVEY_NAME[$i]}"
  local_v="${SURVEY_LOCAL[$i]}"
  registry_v="${SURVEY_REGISTRY[$i]:-${C_GRAY}(unpublished)${C_RESET}}"
  plan="${SURVEY_PLAN[$i]}"
  printf -v name_col "%-32s" "$name"
  printf -v local_col "%-9s" "$local_v"
  printf -v reg_col   "%-13s" "${SURVEY_REGISTRY[$i]:-(none)}"
  case "$plan" in
    publish)     plan_color="${C_GREEN}publish${C_RESET}" ; TO_PUBLISH=$((TO_PUBLISH + 1)) ;;
    publish-new) plan_color="${C_GREEN}publish (new)${C_RESET}" ; TO_PUBLISH=$((TO_PUBLISH + 1)) ;;
    skip)        plan_color="${C_DIM}skip (registry up-to-date)${C_RESET}" ; TO_SKIP=$((TO_SKIP + 1)) ;;
    missing)     plan_color="${C_RED}missing${C_RESET}" ;;
  esac
  printf "%s %s %s %b\n" "$name_col" "$local_col" "$reg_col" "$plan_color"
done

echo
if [[ $TO_PUBLISH -eq 0 ]]; then
  printf "${C_DIM}Nothing to publish — every package is already at its registry version.${C_RESET}\n"
  trap - EXIT INT TERM
  exit 0
fi

printf "${C_BOLD}Summary:${C_RESET} %d to publish, %d already up-to-date.\n" "$TO_PUBLISH" "$TO_SKIP"

# ===== 2. Pre-flight: npm whoami + full CI =====
echo
printf "${C_BOLD}▶ Pre-flight${C_RESET}\n"
if [[ $DRY_RUN -ne 1 ]]; then
  WHOAMI=$(npm whoami 2>/dev/null || true)
  if [[ -z "$WHOAMI" ]]; then
    printf "  ${C_RED}✗${C_RESET} not logged in to npm — run ${C_CYAN}npm login${C_RESET} first.\n"
    trap - EXIT INT TERM
    exit 1
  fi
  printf "  ${C_GREEN}✓${C_RESET} logged in as ${C_CYAN}%s${C_RESET}\n" "$WHOAMI"
else
  printf "  ${C_DIM}skipping whoami check (--dry-run)${C_RESET}\n"
fi

# Run the full CI sweep before any publish lands. Pre-0.10.12 the
# publish flow leaned on each package's `prepublishOnly` for its own
# typecheck + tests — but prepublishOnly fires AFTER the workspace:*
# rewrite + AFTER npm has started uploading. A failure there leaves
# the working tree in the prep-publish'd state (caught by the revert
# trap, but messy) and may have partially uploaded. Running the
# repo-wide CI first turns a publish-time failure into a pre-flight
# failure — same signal, but no half-shipped state.
#
# Skipped on --dry-run because dry-run is for "show me the plan" and
# shouldn't gate on a slow CI sweep.
if [[ $DRY_RUN -ne 1 ]]; then
  printf "  ${C_DIM}running pre-publish CI (lint + typecheck + tests + smoke)...${C_RESET}\n"
  if ! (cd "$REPO" && bun run ci > /tmp/place-publish-ci.log 2>&1); then
    printf "  ${C_RED}✗${C_RESET} pre-publish CI failed. Last 30 lines:\n"
    sed 's/^/      /' /tmp/place-publish-ci.log | tail -30
    printf "  ${C_DIM}Full log: /tmp/place-publish-ci.log${C_RESET}\n"
    trap - EXIT INT TERM
    exit 1
  fi
  printf "  ${C_GREEN}✓${C_RESET} CI clean\n"
else
  printf "  ${C_DIM}skipping CI sweep (--dry-run)${C_RESET}\n"
fi

# ===== 3. Confirm =====
if [[ $DRY_RUN -eq 1 ]]; then
  echo
  printf "${C_BOLD}Dry-run mode${C_RESET} — will pack tarballs but not publish.\n"
elif [[ $SKIP_CONFIRM -ne 1 ]]; then
  echo
  printf "Press ${C_BOLD}enter${C_RESET} to publish %d package(s), or Ctrl-C to abort: " "$TO_PUBLISH"
  read -r _confirm
fi

# ===== 4. Prep (rewrite workspace:*) =====
echo
printf "${C_BOLD}▶ Rewriting workspace:* deps${C_RESET}\n"
bun "$REPO/scripts/prep-publish.ts" --apply 2>&1 | sed 's/^/  /'

# ===== 5. Publish each =====
echo
printf "${C_BOLD}▶ Publishing${C_RESET}\n"
PUBLISHED=()
FAILED=()
SKIPPED=()
PUB_IDX=0
for i in "${!SURVEY_NAME[@]}"; do
  name="${SURVEY_NAME[$i]}"
  local_v="${SURVEY_LOCAL[$i]}"
  plan="${SURVEY_PLAN[$i]}"
  pkg_dir="${SURVEY_DIR[$i]}"
  case "$plan" in
    skip)
      printf "  ${C_DIM}⊘ %s@%s — already on registry${C_RESET}\n" "$name" "$local_v"
      SKIPPED+=("$name@$local_v")
      continue
      ;;
    missing)
      printf "  ${C_YELLOW}? missing package directory${C_RESET}\n"
      continue
      ;;
  esac
  PUB_IDX=$((PUB_IDX + 1))
  if [[ $DRY_RUN -eq 1 ]]; then
    printf "  [${PUB_IDX}/${TO_PUBLISH}] ${C_DIM}would publish${C_RESET} %s@%s (packing only)\n" "$name" "$local_v"
    (cd "$pkg_dir" && bun pm pack >/dev/null 2>&1) || true
    PUBLISHED+=("$name@$local_v")
    continue
  fi
  # Build the publish command. With an OTP we capture output for a clean
  # status line. Without an OTP we run npm directly against the TTY so
  # the browser-auth flow (the "Open this URL in your browser to
  # authenticate" prompt npm uses for accounts with 2FA-on-publish) can
  # actually display + wait. Capturing in that case would silently fail
  # with EOTP, which is what bit us the first time around.
  publish_ok=0
  if [[ -n "$OTP" ]]; then
    # OTP-mode: we capture output for a clean one-line status, because
    # there's no interactive prompt to forward to the user.
    printf "  [${PUB_IDX}/${TO_PUBLISH}] publishing %s@%s (with OTP) … " "$name" "$local_v"
    if (cd "$pkg_dir" && npm publish --otp="$OTP" >/tmp/place-publish-last.log 2>&1); then
      publish_ok=1
    fi
    if [[ $publish_ok -eq 1 ]]; then
      printf "${C_GREEN}✓${C_RESET}\n"
    else
      printf "${C_RED}✗${C_RESET}\n"
      printf "    ${C_RED}npm error:${C_RESET}\n"
      sed 's/^/      /' /tmp/place-publish-last.log | tail -20
    fi
  else
    # No OTP: run npm with stdin/stdout/stderr connected straight to
    # the user's terminal. This is REQUIRED for npm's web-auth flow —
    # npm checks `process.stdout.isTTY`, and if it's anything but a
    # real terminal (a pipe, a redirected file, even a `tee`) npm
    # short-circuits with EOTP instead of printing the auth URL and
    # waiting. So we give up log capture in this mode; npm's full
    # output goes straight to your screen. If it prompts you to open
    # a URL, do that, complete the login in your browser, and npm
    # will resume here automatically once the auth endpoint reports
    # success.
    echo
    printf "  ${C_BOLD}[${PUB_IDX}/${TO_PUBLISH}] publishing %s@%s${C_RESET}\n" "$name" "$local_v"
    printf "  ${C_DIM}↳ if npm prints a URL, open it in your browser to authenticate.${C_RESET}\n"
    if (cd "$pkg_dir" && npm publish); then
      publish_ok=1
      printf "  ${C_GREEN}✓ %s@%s${C_RESET}\n" "$name" "$local_v"
    else
      printf "  ${C_RED}✗ %s@%s (see npm output above)${C_RESET}\n" "$name" "$local_v"
      printf "    ${C_YELLOW}hint:${C_RESET} if you saw EOTP and no URL, your terminal isn't a TTY.\n"
      printf "          Either re-run with ${C_BOLD}--otp <code>${C_RESET}, or generate an automation\n"
      printf "          token at npmjs.com → Access Tokens and add\n"
      printf "          ${C_CYAN}//registry.npmjs.org/:_authToken=<token>${C_RESET} to ~/.npmrc.\n"
    fi
  fi
  if [[ $publish_ok -eq 1 ]]; then
    PUBLISHED+=("$name@$local_v")
    if [[ $TAG_RELEASES -eq 1 ]]; then
      # Use the name in the tag without the @-scope slash, so it works
      # as a git ref (e.g. `place-ts-component@0.10.4`).
      tag_name="${name#@}"
      tag_name="${tag_name//\//-}@${local_v}"
      (cd "$REPO" && git tag -a "$tag_name" -m "$name@$local_v" 2>/dev/null) || true
    fi
  else
    # Detect EOTP in the captured log (OTP-mode path only — the no-OTP
    # path doesn't capture, but it's already obvious from npm's output).
    if [[ -n "$OTP" ]] && grep -q 'code EOTP' /tmp/place-publish-last.log 2>/dev/null; then
      printf "    ${C_YELLOW}hint:${C_RESET} the OTP was rejected or expired. Generate a fresh one and re-run.\n"
    fi
    FAILED+=("$name@$local_v")
    # Continue with remaining packages instead of aborting — partial
    # success is more recoverable than all-or-nothing.
  fi
done

# ===== 6. Optional git tag push =====
if [[ $TAG_RELEASES -eq 1 && $DRY_RUN -ne 1 && ${#PUBLISHED[@]} -gt 0 ]]; then
  echo
  printf "${C_BOLD}▶ Pushing git tags${C_RESET}\n"
  (cd "$REPO" && git push --tags 2>&1 | sed 's/^/  /') || \
    printf "  ${C_YELLOW}!${C_RESET} git push --tags failed (push manually if needed)\n"
fi

# ===== 7. Summary =====
echo
printf "${C_BOLD}─── Summary ───${C_RESET}\n"
if [[ ${#PUBLISHED[@]} -gt 0 ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    printf "  ${C_GREEN}✓ %d would publish:${C_RESET}\n" "${#PUBLISHED[@]}"
  else
    printf "  ${C_GREEN}✓ %d published:${C_RESET}\n" "${#PUBLISHED[@]}"
  fi
  for p in "${PUBLISHED[@]}"; do printf "      %s\n" "$p"; done
fi
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  printf "  ${C_DIM}⊘ %d skipped (already on registry):${C_RESET}\n" "${#SKIPPED[@]}"
  for p in "${SKIPPED[@]}"; do printf "      ${C_DIM}%s${C_RESET}\n" "$p"; done
fi
if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf "  ${C_RED}✗ %d failed:${C_RESET}\n" "${#FAILED[@]}"
  for p in "${FAILED[@]}"; do printf "      %s\n" "$p"; done
  echo
  printf "  ${C_DIM}See /tmp/place-publish-last.log for the most recent error.${C_RESET}\n"
  exit 1
fi

echo
if [[ $DRY_RUN -eq 1 ]]; then
  printf "${C_GREEN}✓ dry-run complete${C_RESET} — re-run without ${C_BOLD}--dry-run${C_RESET} to actually publish.\n"
else
  printf "${C_GREEN}✓ release complete${C_RESET}\n"
fi
