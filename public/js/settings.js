function renderStatusPreview(settings) {
  const preview = document.getElementById("status-preview");
  preview.replaceChildren();

  const nameParagraph = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = settings.displayName || "";
  nameParagraph.appendChild(strong);

  const messageParagraph = document.createElement("p");
  messageParagraph.textContent = settings.statusMessage || "";

  preview.append(nameParagraph, messageParagraph);
}

async function loadSettings() {
  const result = await api("/api/settings");
  const settings = result.settings;

  document.getElementById("settings-form-user-id").value = settings.userId;
  document.getElementById("settings-user-id").value = settings.userId;

  const form = document.getElementById("settings-form");
  form.elements.displayName.value = settings.displayName || "";
  form.elements.theme.value = settings.theme || "classic";
  form.elements.statusMessage.value = settings.statusMessage || "";
  form.elements.emailOptIn.checked = Boolean(settings.emailOptIn);

  renderStatusPreview(settings);
  writeJson("settings-output", settings);
}

(async function bootstrapSettings() {
  try {
    const user = await loadCurrentUser();

    if (!user) {
      writeJson("settings-output", { error: "Please log in first." });
      return;
    }

    await loadSettings();
  } catch (error) {
    writeJson("settings-output", { error: error.message });
  }
})();

document.getElementById("settings-query-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  writeJson("settings-output", {
    info: "Cross-user settings lookup has been disabled."
  });
});

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const payload = {
    displayName: formData.get("displayName"),
    theme: formData.get("theme"),
    statusMessage: formData.get("statusMessage"),
    emailOptIn: formData.get("emailOptIn") === "on"
  };

  const result = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  writeJson("settings-output", result);
  await loadSettings();
});

document.getElementById("enable-email").addEventListener("click", async () => {
  const result = await api("/api/settings/toggle-email", {
    method: "POST",
    body: JSON.stringify({ enabled: true })
  });

  writeJson("settings-output", result);
  await loadSettings();
});

document.getElementById("disable-email").addEventListener("click", async () => {
  const result = await api("/api/settings/toggle-email", {
    method: "POST",
    body: JSON.stringify({ enabled: false })
  });

  writeJson("settings-output", result);
  await loadSettings();
});
