# HomerAI — Git Setup & Management Guide
## v0.5.020

---

## First time setup

```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
git add -A
```

```bash
git commit -m "v0.5.020 — background system toggles consolidated, skip logging, duplicate toggle removed"
```

```bash
git push origin master
```

```bash
git tag -a v0.5.020 -m "v0.5.020 — all background systems toggleable with console feedback"
```

```bash
git push origin --tags
```

---

## Everyday commands

### Commit & push:
```bash
cd /home/ozzy/ai/HomerAI/homerai_dev && git add -A && git commit -m "description" && git push origin master
```

### Push tags:
```bash
git push origin --tags
```

### Pull latest:
```bash
cd /home/ozzy/ai/HomerAI/homerai_dev && git pull origin master
```

### Check status:
```bash
cd /home/ozzy/ai/HomerAI/homerai_dev && git status
```

---

## Run the app

```bash
cd /home/ozzy/ai/HomerAI/homerai_dev && npx tsx server.ts
```
