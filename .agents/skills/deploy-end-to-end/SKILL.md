---
name: deploy-end-to-end
description: Step-by-step playbook for deploying an app end-to-end across Docker, Kubernetes (kubectl), Terraform, Kong, and Istio — the exact command sequence per stage, what to check before moving on, and what to do next if a step fails or succeeds. Use this whenever the user says they're deploying, releasing, rolling out a change, or asks "what's next" / "what command do I run now" / "what do I do after this" during a deploy involving any of these tools. Also use when the user is stuck debugging a failed or stuck deployment step, or wants to roll back a release. The user is still learning this stack (practicing but aiming for real use) and does not yet have a container registry set up — ask before assuming one.
---

# Deploy End-to-End

A staged runbook for taking an app from "code is ready" to "live and verified in the cluster,"
across Docker → Terraform → Kubernetes → Kong → (optionally) Istio.

The user already understands *what* each tool does conceptually. Their gap is purely
**sequencing and "what's next"** — so the job of this skill is to always know which stage
they're at, give the exact command for that stage, tell them what a pass/fail looks like,
and tell them the next action either way. Don't re-explain what Docker or Kubernetes *are*
unless asked.

## How to use this skill in conversation

1. Ask (if not already clear) which stage they're at, or start from Stage 0 if they say
   "I'm deploying now."
2. Give ONE stage's command(s) at a time — don't dump the whole pipeline at once. This
   mirrors how they'll actually work: run a command, see what happens, come back for the
   next one.
3. After each stage, always state: the ✅ check for success, the ❌ most common failure and
   its fix, and what Stage comes next.
4. If the user's registry, cluster provider, or environment specifics aren't known yet
   (see Stage 1 — they haven't set up a registry), ask once, then treat their answer as
   fixed for the rest of the conversation.
5. If they report something not covered below, help them debug it directly rather than
   forcing it into a stage — then note at the end that the runbook could be extended to
   cover it.

---

## Stage 0 — Pre-flight

Before touching any tool, confirm:
- Working tree is clean / changes are committed (`git status`)
- You know which environment you're targeting (local practice cluster vs. staging vs. prod)
- If prod: has anyone else got infra changes in flight? (avoid concurrent `terraform apply`)

❌ If working tree is dirty and this is a real environment: stop, commit or stash first —
half-committed deploys are the #1 cause of "wait, which version is actually running."

---

## Stage 0.5 — Write the Dockerfile (only if one doesn't exist yet)

Skip straight to Stage 1 if a `Dockerfile` already exists in the project.

**Next.js app:**

Use a multi-stage build with the `standalone` output mode — it's dramatically smaller than
copying `node_modules` wholesale. First, in `next.config.js`:
```js
module.exports = { output: 'standalone' }
```

Then the Dockerfile:
```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

**Express (or other plain Node) backend:**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```
Swap `index.js` for the actual entry point (check `main` in `package.json` or your `start`
script), and swap the port for whatever the app actually listens on.

**Also add a `.dockerignore`** (skip this and the build silently drags in gigabytes of junk):
```
node_modules
.next
.git
.env
npm-debug.log
```

✅ Check: `docker build` (Stage 1) succeeds, and running the image locally
(`docker run -p 3000:3000 <image>`) actually serves the app.
❌ Common failure: "Cannot find module" at runtime → you copied the wrong build output, or
forgot `--omit=dev`/multi-stage means `devDependencies` aren't there and something at
runtime needs one of them (move it to `dependencies` instead).
❌ Next.js specifically: if `output: 'standalone'` wasn't set before building, `.next/standalone`
won't exist — add the config, rebuild.

---

## Stage 1 — Build & tag the Docker image

```bash
docker build -t <image-name>:$(git rev-parse --short HEAD) .
```

Tag with the git short SHA (not `latest`) so you always know exactly what code is running
in the cluster later — this matters a lot once you're troubleshooting Stage 4.

✅ Check: build completes with no errors, `docker images` shows the new tag.
❌ Common failure: missing dependency in the build context, or a `.dockerignore` excluding
something the build needs. Read the last ~10 lines of build output for the actual failing
step, not just "build failed."

**Registry note:** the user hasn't set up a container registry yet. Before Stage 2, ask
which they're using (Docker Hub vs. a private/cloud registry like ECR/GCR/ACR) if it's not
already established in the conversation — the login and push commands differ slightly.

---

## Stage 2 — Push to registry

```bash
docker login <registry>          # only needed once per session/machine
docker tag <image-name>:<tag> <registry>/<image-name>:<tag>
docker push <registry>/<image-name>:<tag>
```

✅ Check: push completes, the tag is visible in the registry's web UI or via
`docker manifest inspect <registry>/<image-name>:<tag>`.
❌ Common failure: `unauthorized` → re-run `docker login`. `denied: requested access to the
resource is denied` → check the repo name/namespace matches what you're authorized for.

---

## Stage 3 — Infra changes via Terraform (only if infra actually changed)

Skip this stage entirely if you're just shipping a new app version with no infra changes
(new resource, changed instance size, new secret, etc.) — go straight to Stage 4.

```bash
terraform plan -out=tfplan
```

**Always read the plan output before applying.** Look specifically for:
- Anything marked `-` (destroy) that you didn't expect
- Anything marked `-/+` (replace) on a stateful resource (databases, volumes)

```bash
terraform apply tfplan
```

✅ Check: apply completes, "Apply complete! Resources: X added, Y changed, Z destroyed" —
and Z matches what you expected (ideally 0 for routine deploys).
❌ If the plan shows unexpected destroys or replacements: **STOP. Do not apply.**
Investigate why state diverged (someone changed something manually? state drift?) before
proceeding. This is the single most dangerous step in the whole pipeline.
❌ If apply fails partway through: don't panic-retry. Run `terraform plan` again to see the
actual current state before deciding on the next command — a partial apply is a known,
recoverable state, but only if you look before acting.

---

## Stage 4 — Roll out to Kubernetes

If the image tag changed (normal deploy):

```bash
kubectl set image deployment/<deployment-name> <container-name>=<registry>/<image-name>:<tag>
kubectl rollout status deployment/<deployment-name>
```

If you changed the manifest itself (new env var, resource limits, replicas, etc.):

```bash
kubectl apply -f <manifest-file>.yaml
kubectl rollout status deployment/<deployment-name>
```

✅ Check: `kubectl rollout status` reports "successfully rolled out."
❌ If it hangs / times out:
```bash
kubectl get pods -l app=<deployment-name>
kubectl describe pod <pod-name>       # check Events at the bottom — this is where the real reason lives
```
❌ If a pod is crashlooping:
```bash
kubectl logs <pod-name>               # current attempt's logs
kubectl logs <pod-name> --previous    # logs from the crashed attempt (often the useful one)
```
Common causes at this point: bad env var/config, image can't be pulled (registry auth on
the cluster side, not just your machine), readiness/liveness probe failing because the app
takes longer to start than the probe allows.

---

## Stage 5 — Register / update the route in Kong

New service (first time only):
```bash
curl -i -X POST http://<kong-admin>:8001/services \
  --data name=<service-name> \
  --data url=http://<k8s-service-name>.<namespace>.svc.cluster.local:<port>
```

New route on an existing service:
```bash
curl -i -X POST http://<kong-admin>:8001/services/<service-name>/routes \
  --data 'paths[]=/your-path' \
  --data name=<route-name>
```

Updating an existing service's target (e.g., after a namespace or port change):
```bash
curl -i -X PATCH http://<kong-admin>:8001/services/<service-name> \
  --data url=http://<new-k8s-service-name>.<namespace>.svc.cluster.local:<port>
```

✅ Check: `curl` returns 200/201 and the response body shows the config you expect.
❌ Common failure: Kong returns 200 but requests still 502 → the upstream K8s Service name
or port is wrong, or the pod isn't actually Ready yet (double check Stage 4 first).

---

## Stage 6 — Istio traffic rules (only if doing canary/A-B, otherwise skip)

For a canary release, split traffic between the old and new version using a
`VirtualService` + `DestinationRule` (both versions must be running as separate pods with
distinguishing labels, e.g. `version: v1` / `version: v2`):

```bash
kubectl apply -f destination-rule.yaml   # defines the two subsets (v1/v2)
kubectl apply -f virtual-service.yaml    # defines the traffic weight, e.g. 90/10
```

✅ Check: `kubectl get virtualservice <name> -o yaml` shows the weights you expect.
❌ Common failure: traffic isn't splitting as expected → check that pods actually carry the
subset labels DestinationRule expects (`kubectl get pods --show-labels`), and that there
isn't a conflicting VirtualService for the same host.

To finish the rollout once the canary looks healthy, shift the weight to 100/0 for the new
version, then remove the old version's deployment.

---

## Stage 7 — Verify end-to-end

```bash
curl -I https://<your-endpoint>/health
```

✅ Check: 200 response, and (if you version your health endpoint) the version matches the
tag you just deployed.
❌ 502/503 → work backwards: Kong route correct? (Stage 5) → K8s pods Ready?
(Stage 4) → Istio rules routing correctly if in play? (Stage 6)
❌ 200 but wrong version → you likely verified before the rollout finished, or an old pod
is still receiving traffic — recheck `kubectl rollout status` and Kong/Istio target.

---

## Stage 8 — Rollback (if anything breaks in a real environment)

```bash
kubectl rollout undo deployment/<deployment-name>
kubectl rollout status deployment/<deployment-name>
```

If the break was caused by a Terraform apply rather than the app itself, do **not** blindly
`terraform apply` an old plan — re-run `terraform plan` against current state first, since
state may have moved since the last apply.

---

## Quick "what's next" decision tree

- Just wrote/changed code → Stage 1 (build)
- Image built, need it in the cluster → Stage 2 (push)
- Only infra/config changed, no code change → skip to Stage 3, then Stage 4 (apply manifest, not image)
- Infra unchanged, only app version changed → skip Stage 3, go Stage 1 → 2 → 4
- Deploy done, need it externally reachable for the first time → Stage 5
- Route already exists, nothing routing-related changed → skip Stage 5, go to Stage 7
- Doing a gradual/canary rollout → Stage 6 before Stage 7
- Something's broken post-deploy → Stage 8, then re-diagnose from Stage 4 checks
