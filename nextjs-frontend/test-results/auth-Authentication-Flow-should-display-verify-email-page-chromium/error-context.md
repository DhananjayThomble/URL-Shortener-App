# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e15]:
    - img [ref=e16]
    - heading "Verification Failed" [level=5] [ref=e18]
    - alert [ref=e19]:
      - img [ref=e21]
      - generic [ref=e23]: Invalid or missing verification token.
    - paragraph [ref=e24]: The verification link may be invalid or expired.
    - generic [ref=e25]:
      - button "Resend Verification Email" [ref=e26] [cursor=pointer]
      - button "Back to Sign In" [ref=e27] [cursor=pointer]
```