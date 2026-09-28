# Canonical repository setup

The intended canonical repository is:

`https://github.com/saldfsdk/indexercheck`

The connected GitHub account does not currently contain that repository, and the available connector cannot create repositories. Create it before the first npm publish.

## With GitHub CLI

From the extracted `indexercheck-v0.2.0` source directory:

```powershell
git init
git add .
git commit -m "Release v0.2.0"
git branch -M main
gh repo create saldfsdk/indexercheck --public --source . --remote origin --push
```

Then verify both external publication prerequisites:

```powershell
npm run check:npm-name
npm run check:repository
```

Finally run the complete first-publish gate:

```powershell
npm run check:first-publish
```

Only after that passes should the first registry publication be attempted:

```powershell
npm login
npm publish --access public
```
