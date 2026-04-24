let csrfTokenCache = null;

function resetCsrfTokenCache() {
  csrfTokenCache = null;
}

async function fetchCsrfToken() {
  const response = await fetch("/api/csrf-token", {
    credentials: "same-origin"
  });

  const body = await response.json();

  if (!response.ok) {
    const message = body && body.error ? body.error : response.statusText;
    throw new Error(message);
  }

  return body.csrfToken;
}

async function getCsrfToken() {
  if (!csrfTokenCache) {
    csrfTokenCache = fetchCsrfToken();
  }

  return csrfTokenCache;
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && path !== "/api/login") {
    headers["X-CSRF-Token"] = await getCsrfToken();
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers
  });

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      resetCsrfTokenCache();
    }

    const message = typeof body === "object" && body && body.error ? body.error : response.statusText;
    throw new Error(message);
  }

  return body;
}

async function loadCurrentUser() {
  const data = await api("/api/me");
  return data.user;
}

function writeJson(elementId, value) {
  const target = document.getElementById(elementId);

  if (target) {
    target.textContent = JSON.stringify(value, null, 2);
  }
}
