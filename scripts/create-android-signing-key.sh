#!/usr/bin/env bash
# Run once on the maintainer's Mac/Linux computer; never put this backup in the repository.
set -euo pipefail
umask 077
backup=${1:?Pass an absolute backup directory outside the repository}
case "$backup" in /*) ;; *) echo 'The backup directory must be absolute.' >&2; exit 1 ;; esac
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
case "$backup/" in "$repo/"*) echo 'Keep the signing backup outside the repository.' >&2; exit 1 ;; esac
mkdir -p -- "$backup"
key="$backup/research-bot-release.jks"
secrets="$backup/github-secrets.txt"
if [ -e "$key" ] || [ -e "$secrets" ] || [ -e "$repo/android/release-signing-certificate.sha256" ]; then
  echo 'A signing key, secret backup or committed fingerprint already exists. No files were replaced.' >&2
  exit 1
fi
export RESEARCH_SIGN_STORE_PASSWORD=$(openssl rand -hex 32)
export RESEARCH_SIGN_KEY_PASSWORD=$(openssl rand -hex 32)
keytool -genkeypair -keystore "$key" -storetype JKS -alias research-bot \
  -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Research Bot' \
  -storepass:env RESEARCH_SIGN_STORE_PASSWORD -keypass:env RESEARCH_SIGN_KEY_PASSWORD
certificate="$backup/research-bot-release.der"
keytool -exportcert -keystore "$key" -alias research-bot -file "$certificate" \
  -storepass:env RESEARCH_SIGN_STORE_PASSWORD
fingerprint=$(openssl dgst -sha256 "$certificate" | awk '{print $NF}')
printf '%s\n' "$fingerprint" > "$repo/android/release-signing-certificate.sha256"
{
  printf 'ANDROID_KEYSTORE_BASE64='
  base64 < "$key" | tr -d '[:space:]'
  printf '\nANDROID_KEYSTORE_PASSWORD=%s\n' "$RESEARCH_SIGN_STORE_PASSWORD"
  printf 'ANDROID_KEY_ALIAS=research-bot\n'
  printf 'ANDROID_KEY_PASSWORD=%s\n' "$RESEARCH_SIGN_KEY_PASSWORD"
} > "$secrets"
unset RESEARCH_SIGN_STORE_PASSWORD RESEARCH_SIGN_KEY_PASSWORD
printf '\nBack up %s and %s. Copy these four values to GitHub Actions repository secrets:\n\n' "$key" "$secrets"
cat -- "$secrets"
printf '\nPublic certificate SHA-256: %s\n' "$fingerprint"
printf 'Commit android/release-signing-certificate.sha256; keep the key and secret values private.\n'
