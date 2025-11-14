# System Database Update Guide (Encrypted Files)

**Purpose:** This guide walks you step by step, in very simple language, through what to do **after** you receive updated encrypted data files (the `.enc` files), download them to your computer, and need to put them into the 4Set-Server system.

This is written for non-technical users. Follow the steps in order. If you are not sure, stop and ask the project team before continuing.

---

## 1. Before you start

1. **Make sure you are on the correct computer**
   - Use the computer that is normally used to run the 4Set system.
   - The 4Set-Server folder should already exist on this machine.

2. **Close unnecessary programs**
   - Close Excel, Word, browsers and other programs you do not need.
   - This reduces the chance that files are “in use” and cannot be moved.

3. **Know what you are updating**
   - The encrypted files usually include things like:
     - `coreid.enc` – student IDs and basic details
     - `schoolid.enc` – school information
     - `classid.enc` – class information
     - `credentials.enc` – system and API credentials
   - These files are very important. Treat them like **passwords**.

---

## 2. Downloading the new `.enc` files

1. **Open your email or download link**
   - Use your normal browser (Chrome, Edge, etc.).
   - Open the email or secure link provided by the project team.

2. **Download each `.enc` file**
   - For each file (for example `coreid.enc`):
     - Click the **Download** button or the file link.
     - When the browser asks where to save:
       - Choose the default **Downloads** folder if possible.
       - If the browser does not ask, it usually saves automatically into `Downloads`.

3. **Confirm the files are in `Downloads`**
   - Press `Win + E` to open **File Explorer**.
   - In the left panel, click on **Downloads**.
   - You should see the new `.enc` files, for example:
     - `coreid.enc`
     - `schoolid.enc`
     - `classid.enc`
     - `credentials.enc`

If you do not see the files here, check your browser’s download bar and choose **Show in folder** to locate them.

---

## 3. Opening the Git helper tool (Git GUI)

We will use the helper tool you already have in the 4Set-Server folder. It includes a simple screen to move `.enc` files safely.

1. **Open the 4Set-Server folder**
   - In **File Explorer**, go to:
     - `C:\Users\keysteps\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server`
   - You should see many files like `processor_agent.ps1`, `upload.html`, `git_gui.ps1`, etc.

2. **Double-click the runner**
   - Find `run_git_gui.bat` in the list.
   - Double-click `run_git_gui.bat`.
   - A PowerShell window may appear briefly.
   - After a few seconds, a window titled **“Git Commit & Push (4Set-Server)”** should appear.

If the window does not appear, inform the project team or take a screenshot of any error message.

---

## 4. Understanding the Git GUI window

When the Git GUI window opens, you will see:

1. **Top area**
   - A line showing your **Global Git user** (name and email).
   - A line showing the **Repo**, for example:
     - `Repo: 4Set-Server (origin: git@github.com:herman925/4Set-Server.git)`
   - This confirms you are working in the **correct system**.

2. **Section 1 – `.enc file mover` (top-left)**
   - Source folder for `.enc` files (textbox)
   - Destination folder for `.enc` files (textbox)
   - Button: **Check & Move .enc**

3. **Section 2 – Git operations (bottom-left)**
   - List of files that will be committed.
   - Commit message box.
   - Buttons: **Refresh Changes**, **Commit & Push to master**.

4. **Right side – Instructions**
   - A panel explaining what to do in each section.

For now, we only use **Section 1 – `.enc file mover`**. We will not commit or push until after we confirm the files.

---

## 5. Moving `.enc` files from Downloads into the system

### Step 5.1 – Check the source and destination folders

1. **Source folder**
   - In Section 1, look at **Source folder for .enc files**.
   - It should show something like:
     - `C:\Users\<your name>\Downloads`
   - If this is correct, **do nothing**.
   - If your files are in another folder, click into the box and type the full path (or copy/paste it from File Explorer).

2. **Destination folder**
   - Look at **Destination folder for .enc files**.
   - It should show:
     - `C:\Users\keysteps\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server\assets`
   - This is where the system expects the encrypted files to live.

### Step 5.2 – Detect `.enc` files

1. **Click the button**
   - In Section 1, click **“Check & Move .enc”**.

2. **Review the list**
   - A pop-up window will appear.
   - It will show a list of all `.enc` files found in the **Source** folder, for example:
     - `coreid.enc`
     - `schoolid.enc`
     - `classid.enc`
   - It will then ask if you want to move them to the **Destination** folder.

3. **Confirm the list is correct**
   - Check that the filenames shown match what you expect from the project team.
   - If the names are wrong or unexpected, click **No** or **Cancel** and ask for help.

### Step 5.3 – Move the files

1. **Choose whether to move**
   - The pop-up will ask something like:
     - `Move them to: C:\...\4Set-Server\assets ?`
   - Click **Yes** if you are confident these are the correct new files.
   - Click **No** or **Cancel** if you are unsure.

2. **Handling existing files (overwrite prompts)**
   - If a file with the same name already exists in the **Destination** folder, another small window will appear:
     - For example: `File 'coreid.enc' already exists in assets. Overwrite?`
   - You have three options:
     - **Yes** – replace the old file with the new one.
       - Use this **only when you are sure** you are applying an official update.
     - **No** – skip this one file (keep the existing version).
     - **Cancel** – stop the whole operation and ask for help.

3. **Completion message**
   - When all files are processed, a final message will appear:
     - `.enc file processing completed.`
   - Click **OK**.

At this point, the new encrypted files are now stored inside the system folder and ready for use by the processor agent.

---

## 6. Confirming the files in the `assets` folder

It’s a good idea to visually confirm that the files reached the correct place.

1. **Open the 4Set-Server `assets` folder**
   - In **File Explorer**, go to:
     - `C:\Users\keysteps\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server\assets`

2. **Check the file names and dates**
   - Make sure you see the updated `.enc` files, for example:
     - `coreid.enc`
     - `schoolid.enc`
     - `classid.enc`
     - `credentials.enc`
   - Optionally, look at the **Date modified** column to confirm they match the recent update time.

If any expected file is missing, go back to the GUI and re-run **Check & Move .enc**, or manually move the file from Downloads.

---

## 7. After the encrypted files are updated

Once the `.enc` files are in place:

1. **Processor agent usage**
   - The next time `processor_agent.ps1` or the worker runs, it will use these updated mappings and credentials.
   - There is **no extra action** inside this guide for the agent itself; it just reads the new files.

2. **Optional Git commit & push (for developers/maintainers)**
   - If you are responsible for source control and you intentionally track changes to certain configuration or keys, you may use **Section 2** of the GUI to:
     - Review changed files.
     - Enter a commit message (for example, `Update encrypted mappings 2025-11-14`).
     - Click **Commit & Push to master**.
   - **Important:** Do this only if you understand your team’s Git policy. In many setups, `.enc` files may be kept out of Git or handled in a special way.

If you are not sure whether to commit/push, **do not** commit. Stop here and ask a technical lead.

---

## 8. Safety and troubleshooting

1. **Never share `.enc` files via normal email**
   - Treat them as secrets.
   - Only use approved channels agreed by the project.

2. **If you moved the wrong file**
   - Do **not** delete anything.
   - Inform the project team and share:
     - The file name.
     - The time you did the move.
     - Any screenshots of the GUI.

3. **If the GUI shows an error**
   - Take a screenshot of the error message.
   - Note what you clicked just before the error.
   - Send this information to the technical support contact.

4. **If the processor agent starts failing after an update**
   - There may be a problem with the `.enc` file content.
   - Leave the files as they are.
   - Share the log messages and exact date/time of the update with the development team.

---

## 9. Quick summary (for confident users)

1. Download the new `.enc` files into **Downloads**.
2. Run `run_git_gui.bat` inside the `4Set-Server` folder.
3. In **Section 1 (.enc file mover)**:
   - Confirm **Source** is your Downloads folder.
   - Confirm **Destination** is the `assets` folder in 4Set-Server.
   - Click **Check & Move .enc** and confirm the list.
   - Allow overwrites **only** when you are sure.
4. Confirm the files exist in `assets`.
5. (Optional) Use **Section 2** to commit/push changes if that is part of your role.

If any step is unclear, stop and ask for help before proceeding.
