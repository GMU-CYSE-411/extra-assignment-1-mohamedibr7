function renderAdminUsers(users) {
  const tbody = document.getElementById("admin-users");
  tbody.replaceChildren();

  for (const entry of users) {
    const row = document.createElement("tr");

    for (const value of [
      entry.id,
      entry.username,
      entry.role,
      entry.displayName,
      entry.noteCount
    ]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.appendChild(cell);
    }

    tbody.appendChild(row);
  }
}

(async function bootstrapAdmin() {
  try {
    const user = await loadCurrentUser();

    if (!user) {
      document.getElementById("admin-warning").textContent = "Please log in first.";
      return;
    }

    if (user.role !== "admin") {
      document.getElementById("admin-warning").textContent = "Admin access required.";
      return;
    }

    document.getElementById("admin-warning").textContent = "Authenticated as admin.";

    const result = await api("/api/admin/users");
    renderAdminUsers(result.users);
  } catch (error) {
    document.getElementById("admin-warning").textContent = error.message;
  }
})();
