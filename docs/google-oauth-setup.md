# Google OAuth setup (Supabase)

Neuron users sign in with Google through Supabase Auth. The web app
starts the login with Supabase JS, Supabase handles the Google exchange,
and the browser comes back to the web app's `/auth/callback` route. NestJS
never sees the Google flow; it only verifies the Supabase access token
(JWT) the web app sends as `Authorization: Bearer`.

```
Browser ──► Supabase /auth/v1/authorize?provider=google
        ──► Google consent
        ──► https://<project-ref>.supabase.co/auth/v1/callback
        ──► <web app>/auth/callback   (code exchanged for a session)
```

Do this once per Supabase project (development and production each get
their own Google client).

## 1. Google Cloud OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/), pick
or create a project, then open **Google Auth Platform**:

1.  **Branding:** app name `Neuron` and a support email. Add the app
    domain and links once real domains are chosen.
2.  **Audience:** External. In development, keep the app in **Testing**
    and add the Google accounts that may sign in as test users. Publish
    it before production launch.
3.  **Data access:** only the default non-sensitive scopes: `openid`,
    `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
4.  **Clients → Create client → Web application:**

    | Field | Development | Production |
    |---|---|---|
    | Authorized JavaScript origins | `http://localhost:3001` | `https://<domain>` |
    | Authorized redirect URIs | `https://<dev-project-ref>.supabase.co/auth/v1/callback` | `https://<prod-project-ref>.supabase.co/auth/v1/callback` |

    Copy the exact callback URL from Supabase's Google provider page.

The client secret goes only into the Supabase dashboard. It is not part
of `.env` and never goes into the repository.

## 2. Supabase Auth

In the Supabase dashboard for the project:

1.  **Authentication → Sign In / Providers → Google:** enable it and
    paste the Google client ID and secret.
2.  **Authentication → URL Configuration:**

    | Setting | Development | Production |
    |---|---|---|
    | Site URL | `http://localhost:3001` | `https://<domain>` |
    | Redirect URLs | `http://localhost:3001/auth/callback` | `https://<domain>/auth/callback` |

    The web app runs on port 3001 locally because the API uses 3000.

## 3. Test the flow

Before the web app exists, open this URL in a browser:

```
https://<project-ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://localhost:3001/auth/callback
```

After signing in with Google you land on `localhost:3001`, which does
not load yet. The login worked if the address contains
`#access_token=...` (or `?code=...`), and the account appears under
**Authentication → Users**.

That address holds a live session (access, refresh, and Google provider
tokens). Do not paste or share it. If it leaks, sign the user out under
**Authentication → Users**, which revokes the refresh token.

## What the API relies on

Checked against a development token:

-   **Signing:** asymmetric keys (`ES256`, with a `kid` header). NestJS
    verifies tokens with the project's public keys at
    `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`, so
    no JWT secret is needed (Feature 1.2).
-   **Issuer (`iss`):** `https://<project-ref>.supabase.co/auth/v1`
-   **Audience (`aud`):** `authenticated`
-   **Subject (`sub`):** the Supabase user ID (`auth.users.id`)
-   **Profile data:** `email`, plus `user_metadata.full_name` and
    `user_metadata.avatar_url` from Google (used by Feature 1.3).
