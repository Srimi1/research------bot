# Authentication decision

Checked against official OpenAI documentation on 2026-10-05.

## Intended route

Use official Sign in with ChatGPT for the personal local app. Eligible plan usage is documented for local/open-source apps. A private development repository does not establish eligibility for a public hosted service. Paid/remotely hosted distribution needs the OpenAI interest/application route.

Sign-in and authorization to use the ChatGPT plan are distinct. The flow does not expose ChatGPT conversation history. Normal API usage remains separately billed; any future API-key option must require explicit opt-in.

## Implementation requirements

- Persist a stable opaque host ID and the issued registration for the account/workspace.
- Use the system-browser OAuth flow with PKCE, state, nonce, token validation, and granted-scope checks.
- Protect credentials in the local main process; support refresh and revocation recovery.
- Discover available models rather than assume account access.
- Use Responses streaming with `store: false`, explicit input history, and locally coordinated roles.
- Check model/account policy before enabling web search. Use local retrieval rather than unsupported hosted file search.
- Handle denied consent, unsupported accounts, exhausted allowance, and cancellation clearly; do not silently incur API charges.

The desktop authentication flow is implemented with mocked protocol tests. Live account consent, eligibility, and inference remain unverified until the researcher signs in. The app does not copy cookies, scrape ChatGPT sessions, or reuse Codex credential files.

## References

- [ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Official integration walkthrough](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [Separate ChatGPT and API billing](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform)

Recheck the preview documentation at implementation time. Account eligibility and a successful real sign-in remain open validation items.
