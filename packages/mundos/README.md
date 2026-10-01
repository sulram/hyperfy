# mundos plugin

Entry by mundos's account instead of the anonymous user the server creates: who a connection is comes from a short-lived token mundos signs for this world. Fork-only; it stands on the identity hook (hyperfy-xyz/hyperfy#166).

## Variables

Set per instance by mundos, beside `JWT_SECRET` and `ADMIN_CODE`:

- `MUNDOS_PUBLIC_KEY`: the Ed25519 public key (PEM, SPKI) that verifies tokens. `\n` in the value is accepted.
- `PUBLIC_MUNDOS_WORLD`: the world's name, the token's audience. Stable across generations and addresses.
- `PUBLIC_MUNDOS_URL`: where mundos is; the client is sent there to enter, and the admin link points there.

Without `MUNDOS_PUBLIC_KEY` and `PUBLIC_MUNDOS_WORLD` the server registers no provider, and without `PUBLIC_MUNDOS_URL` the client does nothing, so a dev world behaves as upstream.

## Flow

1. The client loads `https://<host>/`. Without `#identity=` in the fragment it navigates to `${PUBLIC_MUNDOS_URL}/enter?host=<host>`.
2. mundos validates the host against the world's addresses, signs the person in if needed, and sends them back to `https://<host>/#identity=<token>`, or `#identity=guest`.
3. The client strips the fragment (`history.replaceState`) and puts the value in `world.network.params.identity`, which the connection carries.
4. The server verifies the token (`alg` EdDSA with `MUNDOS_PUBLIC_KEY`; `iss` `mundos`; `aud` equal to `PUBLIC_MUNDOS_WORLD`; `exp`, 30 s of leeway) and answers the identity hook with `{ id: sub, name, rank }`. A missing or `guest` value, or a refused token, is a guest.

Token claims: `iss`, `sub` (account id), `aud` (world name), `name`, `level`, `iat`, `exp` (about 60 s; every load passes through mundos).

Level to rank: `admin` (and `superadmin`) → ADMIN; `builder` → BUILDER; `signed_in` → VISITOR, or BUILDER with Free Build for accounts on; `anonymous` → VISITOR.

## Free Build for accounts

Everyone with an account builds, guests never do. The admin flips it in the Mundos pane or with `/freebuild on|off`; it applies at once to connected accounts and is kept in `<WORLD>/mundos.json`, which an upgrade copies. The core Free Build setting is inert with a provider (identity hook).

`GET /api/mundos` returns `{ world, freeBuild }`.

## Pane

Guests see a "Sign in" button to the enter URL. Signed-in players see their name; admins also get the Free Build toggle and "Open in mundos" (`${PUBLIC_MUNDOS_URL}/worlds/${PUBLIC_MUNDOS_WORLD}`).
