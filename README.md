# Schematics & Graphics Flow (Firebase + Netlify)

A shared tracker for BAS engineering projects. It covers controller schematics in Visio, engineering review, submittal approval, programming, station graphics, QC and closeout. Everyone signed in sees changes the moment they happen.

| Piece | Where it runs | Cost |
|---|---|---|
| The app (static files in `public/`) | Netlify | 15 credits per deploy, plus a few credits a month in bandwidth |
| Sign-in (email and password) | Firebase Authentication | Free (Spark plan) |
| Shared data and live updates | Cloud Firestore | Free (Spark plan: 50K reads and 20K writes per day) |

The Spark plan has hard limits and no billing, so it can't run up a bill.

---

## Part 1: Firebase (about 15 minutes)

### 1. Create the project
1. Go to <https://console.firebase.google.com> and sign in with the Google account that will own the board.
2. Select **Create a project** and name it something like `applied-bas-flow`. You can turn Google Analytics off.

### 2. Register the web app and copy its settings
1. On the project overview, click the **Web** icon (`</>`) to add an app. Name it `BAS Flow`. Leave Firebase Hosting unchecked.
2. Firebase shows a `firebaseConfig = { ... }` block. Copy the six values into **`public/config.js`**, replacing the `PASTE_…` placeholders.
   - These values aren't secret. They identify your project, and the security rules in step 4 control who gets in.
   - You can find them again later under **Project settings → General → Your apps**.

### 3. Turn on email sign-in
1. Go to **Build → Authentication → Get started**.
2. On the **Sign-in method** tab, choose **Email/Password**, switch on the first toggle, and save. Leave "Email link" off.
3. On the **Settings** tab, open **Authorized domains** and add your Netlify address (for example `bas-flow.netlify.app`) and any custom domain you plan to use.

### 4. Create the database and lock it down
1. Go to **Build → Firestore Database → Create database**.
2. Pick a location near you, such as a US multi-region like `nam5`. You can't change it later.
3. Choose **Start in production mode**.
4. Open the **Rules** tab and replace everything there with the contents of **`firestore.rules`** from this folder. Click **Publish**.

### 5. Add the team list
The rules only let in people whose email is on this list.
1. In Firestore, open the **Data** tab and choose **+ Start collection**.
2. Collection ID: `config`. Document ID: `access`.
3. Add a field named `emails` of type **array**. Add one entry (type **string**) per person, **in lowercase**, for example `chris@appliedbas.com`.
4. Save.

To add or remove someone later, edit this list. A person removed from the list loses access right away.

### 6. Create the accounts
1. Go to **Authentication → Users → Add user**.
2. For each team member (including yourself), enter their email and a temporary password.
3. Tell each person to open the site and click **"Forgot or need a password?"**. Firebase emails them a link to set their own password. They can also sign in with the temporary password if you share it.

> Every account must have its email on the team list from step 5. Otherwise the person signs in and sees "Not on the team list yet".

---

## Part 2: Netlify (about 5 minutes)

### 7. Put it on GitHub
Create a new repository, such as `bas-flow`, and upload everything in this folder except `node_modules/`. Make sure `public/config.js` contains your values from step 2.

### 8. Deploy
1. In Netlify, choose **Add new project → Import an existing project → GitHub**, then pick the repo.
2. Netlify reads the build settings from `netlify.toml` (build `npm run build`, publish `public`). Click **Deploy**.
3. If Netlify gives the site a different address than the one you added in step 3, add the real address to Firebase **Authorized domains** too.

### 9. First sign-in
1. Open the site and sign in.
2. Enter your name, which is what the team sees.
3. Create a test project and tick a checkbox.
4. Open the site on your phone, signed in as yourself. The checkbox you ticked should show there right away.

---

## Day-to-day use

- **New project:** enter the job number, name and customer, then set the scope switches (Controller drawings, Submittals). The person who creates a project becomes its Project Manager.
- **Team panel:** assign the PM, ENG, VSO, PRG and GFX roles. People show up in the list after they've signed in once. *Use typed name* adds a placeholder for someone who hasn't signed in yet.
- **Reviews and the submittal gate:** approve, or enter redline comments and return the work. Returning work reopens the target step and resets the steps after it. Returning drawings bumps the revision (Rev A → B).
- **Install as an app:** on a phone, use **Add to Home Screen**. On a desktop, use the install icon in the Chrome or Edge address bar.
- **Offline:** changes made offline are saved on the device and sync when the connection returns.

## Changing the process

Step titles, checklists, roles and dependencies all live in **`public/flow.js`**. Edit it, commit, and Netlify redeploys. Keep step ids (`s01`…`s13`) stable once projects exist, because saved progress is stored by id.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Almost there… isn't connected to Firebase yet" | `public/config.js` still has `PASTE_…` values. |
| "Not on the team list yet" | Add that exact email, in lowercase, to `config/access → emails`, then reload. |
| Stuck on "Loading the board…" | The rules from step 4 weren't published, or `projectId` in `config.js` is wrong. |
| "Email or password is wrong" | Use "Forgot or need a password?" to set a new one. |
| Password reset email never arrives | Check spam. The sender is `noreply@<project>.firebaseapp.com`. |

## Files

- `public/` — the app: `index.html`, `app.js` (screens), `data.js` (all Firebase calls), `flow.js` (the process), `config.js` (your Firebase settings)
- `firestore.rules` — security rules to paste into the Firebase console. With the Firebase CLI you can deploy them with `firebase deploy --only firestore:rules`.
- `src/firebase-entry.js` — the build bundles the Firebase SDK into `public/vendor/firebase.js`. A prebuilt copy is included.
- `test/fake-data.js` — an in-memory stand-in for `data.js`, used to click through the screens without Firebase
