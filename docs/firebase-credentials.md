# Firebase credentials

TTSReader cloud playback uses a short-lived Firebase ID token. To let the plugin refresh it automatically, copy the Firebase API key and refresh token from the signed-in TTSReader website session.

Open `https://ttsreader.com/`, sign in, then open DevTools and run these snippets in the Console.

## Copy Firebase API key

```js
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open("firebaseLocalStorageDb");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const records = await new Promise((resolve, reject) => {
  const tx = db.transaction("firebaseLocalStorage", "readonly");
  const store = tx.objectStore("firebaseLocalStorage");
  const req = store.getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const record = records.find((item) => item?.value?.apiKey);
if (!record) {
  throw new Error("No Firebase auth record found. Make sure you are signed in on ttsreader.com.");
}

const apiKey = record.value.apiKey;
const textarea = document.createElement("textarea");
textarea.value = apiKey;
textarea.style.position = "fixed";
textarea.style.left = "-9999px";
document.body.appendChild(textarea);
textarea.focus();
textarea.select();
document.execCommand("copy");
textarea.remove();

console.log("Firebase API key copied. length =", apiKey.length);
```

## Copy Firebase refresh token

```js
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open("firebaseLocalStorageDb");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const records = await new Promise((resolve, reject) => {
  const tx = db.transaction("firebaseLocalStorage", "readonly");
  const store = tx.objectStore("firebaseLocalStorage");
  const req = store.getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const record = records.find((item) => item?.value?.stsTokenManager?.refreshToken);
if (!record) {
  throw new Error("No Firebase refresh token found. Make sure you are signed in on ttsreader.com.");
}

const refreshToken = record.value.stsTokenManager.refreshToken;
const textarea = document.createElement("textarea");
textarea.value = refreshToken;
textarea.style.position = "fixed";
textarea.style.left = "-9999px";
document.body.appendChild(textarea);
textarea.focus();
textarea.select();
document.execCommand("copy");
textarea.remove();

console.log("Firebase refresh token copied. length =", refreshToken.length);
console.log("contains ellipsis =", refreshToken.includes("...") || refreshToken.includes("…"));
```

Paste the copied values into the plugin settings:

- `Firebase API key`
- `Firebase refresh token`

The refresh token is sensitive. Treat it like a password and do not publish it.
