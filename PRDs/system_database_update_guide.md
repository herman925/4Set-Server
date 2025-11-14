# 4Set System Server Database Update – Operator Flow

**Always follow these 5 blocks in order.**

---

## 1. Update CSVs – "4Set System Assets" (Desktop)

1. On **Desktop**, open **"4Set System Assets"**.
2. Open the CSVs you need (`coreid.csv`, `schoolid.csv`, `classid.csv`, etc.) in Excel.
3. Update data from **AITable** (do not change column names or order).
4. **Save as UTF‑8 CSV** (if characters look wrong, re‑save explicitly as UTF‑8).

---

## 2. Encrypt – "4Set Encrypter"

1. Open the **"4Set Encrypter"** shortcut on Desktop.
2. In the Encrypter, do **Step 1** and **Step 2 only**.
3. **Do NOT** do Step 3!

Result: new encrypted `.enc` files are created - usually defaulted in **Downloads** folder.

---

## 3. Check `.enc` Files – Downloads

1. Open **File Explorer → Downloads** (or use Win + E, then select Downloads).
2. Confirm all required `.enc` files are there  
   (e.g. `coreid.enc`, `schoolid.enc`, `classid.enc`, `credentials.enc`).
3. If anything is missing, go back to the Encrypter and repeat Steps 1–2 for that file.

---

## 4. Move `.enc` – Checking System Updater (Python GUI)

1. Run the **"Checking System Updater"** (Python GUI).
2. In the GUI:
   - **Source** folder: `Downloads`.  
   - **Destination** folder: `4Set-Server\assets`.
3. Use the GUI's **.enc move** function:
   - Review the list of files.
   - Overwrite only if you are sure they are the official new files.

---

## 5. CRITICAL: Refresh Changes → Then Commit & Push

1. After the `.enc` move is done, click **"Refresh Changes"** in the GUI.  
   - **This is critical – never skip it.**
2. Check the change list (only the files you expect, especially `.enc` files).
3. Enter a clear commit message  
   (e.g. `2025-11-14 system DB update from AITable`).
4. Click **"Commit & Push to master"**.
5. (Optional) Confirm on GitHub that the latest commit and changed files match your update.

