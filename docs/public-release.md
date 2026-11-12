# Preparing a public source release

Keep private working history private. Earlier commits may contain local paths,
device names, or project references even after those strings are removed from HEAD.
Do not make an existing personal repository public without reviewing its history.

From a clean, reviewed commit:

```sh
npm run check:public
node scripts/export-public.mjs
```

The export creates `artifacts/wired-source.zip` from HEAD. It contains source
files with no `.git` directory, local credentials, conversation artifacts, or build
outputs. Review the archive before importing it into a new public repository with
fresh history. The scanner checks common patterns and the local bridge token; it
is not a guarantee that every private detail has been removed.

Review screenshots separately. Use fake sessions for public examples. Keep signing
keys private. The package ID remains `dev.rapina.herdrpocket` so installed users can
upgrade; forks should choose their own ID before distribution.

Source code is MIT. Retain `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `licenses/`.
