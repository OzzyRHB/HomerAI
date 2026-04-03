# HomerAI — Git Setup & Management Guide
## v0.5.017 | Rebranded from QuestForge

---

## STEP 1: Copy the patched files into your working directory

First, extract the downloaded `HomerAI-v0.5.017` folder contents.
Then copy everything into your working directory:

```bash
# Create the working directory if it doesn't exist
mkdir -p /home/ozzy/ai/HomerAI/homerai_dev

# Copy all patched files into place (from wherever you downloaded them)
# Adjust the source path to match where you extracted the zip
cp -r ~/Downloads/HomerAI-v0.5.017/* /home/ozzy/ai/HomerAI/homerai_dev/
```

---

## STEP 2: Initialize git and connect to the new repo

```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
git init
```

```bash
git remote add origin https://github.com/OzzyRHB/HomerAI.git
```

```bash
git fetch origin
```

---

## STEP 3: First commit & push

```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
git add -A
```

```bash
git commit -m "v0.5.017 — HomerAI rebrand + manual cards, VRAM optimization, UI updates"
```

Since the remote already has a tiny README, you need to either force-push or merge.
**Option A — Force push (clean start, overwrites the remote README):**

```bash
git branch -M master
```

```bash
git push -u origin master --force
```

**Option B — Merge with existing README first (safer):**

```bash
git pull origin master --allow-unrelated-histories
```
*(Resolve any merge conflicts if they appear, then:)*

```bash
git push -u origin master
```

---

## STEP 4: Tag the version

```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
git tag -a v0.5.017 -m "v0.5.017 — HomerAI rebrand + manual cards, VRAM opt, UI updates"
```

```bash
git push origin --tags
```

---

## STEP 5: Set up credential store (so you don't re-enter passwords)

```bash
git config --global credential.helper store
```

*(Next time you enter your username/token, git remembers it.)*

---

## EVERYDAY COMMANDS

### After making changes — commit & push:
```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
git add -A
```

```bash
git commit -m "v0.5.0XX — description of changes"
```

```bash
git push origin master
```

```bash
git push origin --tags
```

### Pull latest from remote (if edited elsewhere):
```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
git pull origin master
```

### Check what's changed:
```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
git status
```

### View recent commits:
```bash
git log --oneline -10
```

---

## INSTALL DEPENDENCIES (first time in the new directory)

```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
npm install
```

---

## RUN THE APP

```bash
cd /home/ozzy/ai/HomerAI/homerai_dev
```

```bash
npx tsx server.ts
```

Then open Brave to `http://localhost:3000`

---

## IMPORTANT NOTES

- **All git commands use**: `/home/ozzy/ai/HomerAI/homerai_dev`
- **Old QuestForge repo** at `github.com/OzzyRHB/QuestForge` still exists — you can archive or keep it
- **Models folder**: Still at `~/models/` — no change needed
- **Saves**: Existing adventure saves in the old directory will need to be exported (JSON) and re-imported if you want to carry them over
- **No rebase**: This is a fresh repo — no rebase conflicts to worry about!
