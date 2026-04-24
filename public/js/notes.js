let currentUserId = null;

function renderNotes(notes) {
  const notesList = document.getElementById("notes-list");
  notesList.replaceChildren();

  if (!Array.isArray(notes) || notes.length === 0) {
    notesList.textContent = "No notes found.";
    return;
  }

  for (const note of notes) {
    const article = document.createElement("article");
    article.className = "note-card";

    const title = document.createElement("h3");
    title.textContent = note.title;

    const meta = document.createElement("p");
    meta.className = "note-meta";
    meta.textContent = `Owner: ${note.ownerUsername} | ID: ${note.id} | Pinned: ${note.pinned}`;

    const body = document.createElement("div");
    body.className = "note-body";
    body.textContent = note.body;

    article.append(title, meta, body);
    notesList.appendChild(article);
  }
}

async function loadNotes(search) {
  const query = new URLSearchParams();

  if (search) {
    query.set("search", search);
  }

  const result = await api(`/api/notes?${query.toString()}`);
  renderNotes(result.notes);
}

(async function bootstrapNotes() {
  try {
    const user = await loadCurrentUser();

    if (!user) {
      document.getElementById("notes-list").textContent = "Please log in first.";
      return;
    }

    currentUserId = user.id;

    const notesOwnerField = document.getElementById("notes-owner-id");
    if (notesOwnerField) {
      notesOwnerField.value = String(user.id);
      notesOwnerField.readOnly = true;
      notesOwnerField.disabled = true;
    }

    const createOwnerField = document.getElementById("create-owner-id");
    if (createOwnerField) {
      createOwnerField.value = String(user.id);
      createOwnerField.readOnly = true;
      createOwnerField.disabled = true;
    }

    await loadNotes("");
  } catch (error) {
    document.getElementById("notes-list").textContent = error.message;
  }
})();

document.getElementById("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  await loadNotes(formData.get("search"));
});

document.getElementById("create-note-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const payload = {
    title: formData.get("title"),
    body: formData.get("body"),
    pinned: formData.get("pinned") === "on"
  };

  await api("/api/notes", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  await loadNotes("");
  event.currentTarget.reset();

  const createOwnerField = document.getElementById("create-owner-id");
  if (createOwnerField && currentUserId !== null) {
    createOwnerField.value = String(currentUserId);
  }
});
