import json
import os
import tkinter as tk
from tkinter import messagebox, filedialog


CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "agent.json")
CONFIG_PATH = os.path.abspath(CONFIG_PATH)


class AgentConfigGUI:
    def __init__(self, master):
        self.master = master
        master.title("4Set Processor Agent Configuration")
        master.resizable(True, True)
        master.grid_rowconfigure(0, weight=1)
        master.grid_columnconfigure(0, weight=1)

        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                self.config = json.load(f)
        except FileNotFoundError:
            messagebox.showerror("Error", f"Configuration file not found:\n{CONFIG_PATH}")
            master.destroy()
            return
        except json.JSONDecodeError as exc:
            messagebox.showerror("Error", f"Failed to parse configuration:\n{exc}")
            master.destroy()
            return

        # Keep a snapshot of the defaults as the current file contents
        self.defaults = {
            "relativePath": self.config.get("oneDrive", {}).get("relativePath", ""),
            "fallbackRoot": self.config.get("oneDrive", {}).get("fallbackRoot", ""),
            "watchPath": self.config.get("watchPath", ""),
            "stagingPath": self.config.get("stagingPath", ""),
            "filingRoot": self.config.get("filingRoot", ""),
            "unsortedRoot": self.config.get("unsortedRoot", "")
        }

        self.entries = {}
        form_frame = tk.Frame(master, padx=16, pady=16)
        form_frame.grid(row=0, column=0, sticky="nsew")
        form_frame.grid_columnconfigure(1, weight=1)

        row = 0
        self._add_entry(form_frame, row, "OneDrive Relative Path", "relativePath", editable=True)
        row += 1
        self._add_entry(form_frame, row, "OneDrive Fallback Root", "fallbackRoot", editable=False)
        row += 1
        self._add_entry(form_frame, row, "Watch Path", "watchPath", editable=True)
        row += 1
        self._add_entry(form_frame, row, "Staging Path", "stagingPath", editable=True)
        row += 1
        self._add_entry(form_frame, row, "Filing Root", "filingRoot", editable=True)
        row += 1
        self._add_entry(form_frame, row, "Unsorted Root", "unsortedRoot", editable=True)

        button_frame = tk.Frame(master, padx=16, pady=8)
        button_frame.grid(row=1, column=0, sticky="ew")

        save_button = tk.Button(button_frame, text="Save", command=self.save_config, width=12)
        save_button.pack(side=tk.LEFT, padx=(0, 8))

        reset_button = tk.Button(button_frame, text="Reset to Defaults", command=self.reset_defaults, width=18)
        reset_button.pack(side=tk.LEFT, padx=(0, 8))

        reload_button = tk.Button(button_frame, text="Reload from File", command=self.reload_from_file, width=16)
        reload_button.pack(side=tk.LEFT)

        status_frame = tk.Frame(master, padx=16, pady=8)
        status_frame.grid(row=2, column=0, sticky="ew")
        self.status_var = tk.StringVar()
        self.status_label = tk.Label(status_frame, textvariable=self.status_var, anchor="w")
        self.status_label.pack(fill="x")
        self.set_status("Loaded configuration from agent.json")

    def _add_entry(self, parent, row, label_text, key, editable=True):
        label = tk.Label(parent, text=label_text, anchor="w")
        label.grid(row=row, column=0, sticky="w", pady=4)

        entry_var = tk.StringVar(value=self.defaults.get(key, ""))
        entry = tk.Entry(parent, textvariable=entry_var, width=60)
        entry.grid(row=row, column=1, padx=(8, 0), pady=4, sticky="ew")

        if editable:
            browse_button = tk.Button(parent, text="...", width=3, command=lambda: self._browse(entry_var))
            browse_button.grid(row=row, column=2, padx=(4, 0))
        else:
            entry.configure(state=tk.DISABLED)

        self.entries[key] = {
            "var": entry_var,
            "editable": editable
        }

    def _browse(self, var):
        initial_dir = var.get() or os.path.dirname(CONFIG_PATH)
        path = filedialog.askdirectory(initialdir=initial_dir, title="Select Folder")
        if path:
            var.set(path)

    def save_config(self):
        updated = False

        one_drive = self.config.setdefault("oneDrive", {})

        for key, meta in self.entries.items():
            var = meta["var"]
            editable = meta["editable"]
            value = var.get().strip()

            if key in ("relativePath", "fallbackRoot"):
                if not editable:
                    # Read-only field; skip persisting changes
                    continue
                if one_drive.get(key) != value:
                    one_drive[key] = value
                    updated = True
            else:
                current_value = self.config.get(key)
                if current_value != value:
                    self.config[key] = value
                    updated = True

        if not updated:
            self.set_status("No changes to save.")
            return

        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
                f.write("\n")
        except OSError as exc:
            messagebox.showerror("Error", f"Failed to write configuration:\n{exc}")
            return

        # Refresh defaults to the newly saved values
        for key, meta in self.entries.items():
            self.defaults[key] = meta["var"].get().strip()

        self.set_status("Configuration saved.")

    def reset_defaults(self):
        for key, meta in self.entries.items():
            meta["var"].set(self.defaults.get(key, ""))
        self.set_status("Fields reset to defaults (current file values).")

    def reload_from_file(self):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                self.config = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            messagebox.showerror("Error", f"Failed to reload configuration:\n{exc}")
            return

        self.defaults = {
            "relativePath": self.config.get("oneDrive", {}).get("relativePath", ""),
            "fallbackRoot": self.config.get("oneDrive", {}).get("fallbackRoot", ""),
            "watchPath": self.config.get("watchPath", ""),
            "stagingPath": self.config.get("stagingPath", ""),
            "filingRoot": self.config.get("filingRoot", ""),
            "unsortedRoot": self.config.get("unsortedRoot", "")
        }

        for key, meta in self.entries.items():
            meta["var"].set(self.defaults.get(key, ""))

        self.set_status("Reloaded configuration from file.")

    def set_status(self, message):
        self.status_var.set(message)


def main():
    root = tk.Tk()
    AgentConfigGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
