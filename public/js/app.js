(() => {
  "use strict";

  const STORAGE_KEY = "resume-builder-state-v1";

  // Local dev (this Express server) posts the raw PDF text to its own API.
  // Anywhere else (e.g. GitHub Pages), there's no server to keep the Anthropic
  // key secret, so the same request goes to a Cloudflare Worker instead.
  const IMPORT_ENDPOINT =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "/api/import-resume"
      : "https://resume-builder-import.city-weather.workers.dev/import";

  const lists = {
    links: document.getElementById("links-list"),
    education: document.getElementById("education-list"),
    experience: document.getElementById("experience-list"),
    projects: document.getElementById("projects-list"),
    skills: document.getElementById("skills-list"),
    awards: document.getElementById("awards-list"),
  };

  const templates = {
    links: document.getElementById("tpl-link-row"),
    education: document.getElementById("tpl-education-entry"),
    experience: document.getElementById("tpl-experience-entry"),
    projects: document.getElementById("tpl-project-entry"),
    skills: document.getElementById("tpl-skill-entry"),
    awards: document.getElementById("tpl-award-entry"),
  };

  const preview = document.getElementById("preview");
  const form = document.getElementById("resume-form");
  const importInput = document.getElementById("import-input");
  const importStatus = document.getElementById("import-status");
  const resetBtn = document.getElementById("reset-btn");
  const printBtn = document.getElementById("print-btn");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loadingText = document.getElementById("loading-text");

  function showLoading(text) {
    loadingText.textContent = text;
    loadingOverlay.hidden = false;
  }
  function hideLoading() {
    loadingOverlay.hidden = true;
  }

  // ---------- Row creation ----------

  function addEntry(kind, data = {}) {
    const node = templates[kind].content.firstElementChild.cloneNode(true);
    node.querySelectorAll("[data-field]").forEach((el) => {
      const key = el.dataset.field;
      if (data[key] === undefined) return;
      if (Array.isArray(data[key])) {
        el.value = data[key].join("\n");
      } else {
        el.value = data[key];
      }
    });
    lists[kind].appendChild(node);
  }

  document.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      addEntry(btn.dataset.add);
      scheduleRender();
      persist();
    });
  });

  document.addEventListener("click", (e) => {
    if (e.target.matches(".remove-btn")) {
      e.target.closest(".entry").remove();
      scheduleRender();
      persist();
    }
  });

  // ---------- Data collection ----------

  function readEntries(kind, fields) {
    return Array.from(lists[kind].children).map((entry) => {
      const obj = {};
      fields.forEach((f) => {
        const el = entry.querySelector(`[data-field="${f}"]`);
        obj[f] = el ? el.value : "";
      });
      return obj;
    });
  }

  function linesToArray(text) {
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function collectResumeData() {
    return {
      name: document.getElementById("field-name").value.trim(),
      title: document.getElementById("field-title").value.trim(),
      email: document.getElementById("field-email").value.trim(),
      phone: document.getElementById("field-phone").value.trim(),
      location: document.getElementById("field-location").value.trim(),
      summary: document.getElementById("field-summary").value.trim(),
      links: readEntries("links", ["label", "url"]).filter((l) => l.label || l.url),
      education: readEntries("education", ["school", "location", "degree", "start", "end", "details"]),
      experience: readEntries("experience", ["title", "company", "location", "start", "end", "bullets"]).map(
        (e) => ({ ...e, bullets: linesToArray(e.bullets) })
      ),
      projects: readEntries("projects", ["name", "tech", "start", "end", "bullets"]).map((p) => ({
        ...p,
        bullets: linesToArray(p.bullets),
      })),
      skills: readEntries("skills", ["category", "items"]).filter((s) => s.category || s.items),
      certifications: linesToArray(document.getElementById("field-certifications").value),
      awards: readEntries("awards", ["title", "org", "location", "date"]),
      template: document.querySelector('input[name="template"]:checked').value,
    };
  }

  // ---------- Populate form from resume data (used by import) ----------

  function clearList(kind) {
    lists[kind].innerHTML = "";
  }

  function populateForm(data) {
    document.getElementById("field-name").value = data.name || "";
    document.getElementById("field-title").value = data.title || "";
    document.getElementById("field-email").value = data.email || "";
    document.getElementById("field-phone").value = data.phone || "";
    document.getElementById("field-location").value = data.location || "";
    document.getElementById("field-summary").value = data.summary || "";
    document.getElementById("field-certifications").value = (data.certifications || []).join("\n");

    clearList("links");
    (data.links || []).forEach((l) => addEntry("links", l));

    clearList("education");
    (data.education || []).forEach((e) => addEntry("education", e));

    clearList("experience");
    (data.experience || []).forEach((e) => addEntry("experience", e));

    clearList("projects");
    (data.projects || []).forEach((p) => addEntry("projects", p));

    clearList("skills");
    (data.skills || []).forEach((s) => addEntry("skills", s));

    clearList("awards");
    (data.awards || []).forEach((a) => addEntry("awards", a));

    if (data.template) {
      const radio = document.querySelector(`input[name="template"][value="${data.template}"]`);
      if (radio) radio.checked = true;
    }
  }

  // ---------- Rendering ----------

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderContactLine(data) {
    const parts = [];
    if (data.location) parts.push(esc(data.location));
    if (data.email) parts.push(esc(data.email));
    if (data.phone) parts.push(esc(data.phone));
    (data.links || []).forEach((l) => {
      if (!l.label && !l.url) return;
      const label = esc(l.label || l.url);
      const url = esc(l.url || "#");
      parts.push(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
    });
    return parts.map((p) => `<span>${p}</span>`).join("");
  }

  function renderDateRange(start, end) {
    if (!start && !end) return "";
    return `${esc(start)}${start && end ? " - " : ""}${esc(end)}`;
  }

  function renderBullets(bullets) {
    if (!bullets || !bullets.length) return "";
    return `<ul class="rp-bullets">${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  }

  function renderEducation(items) {
    if (!items.length) return "";
    const rows = items
      .filter((e) => e.school || e.degree)
      .map(
        (e) => `
        <div class="rp-entry">
          <div class="rp-row">
            <span class="rp-title-line">${esc(e.school)}</span>
            <span>${renderDateRange(e.start, e.end)}</span>
          </div>
          <div class="rp-row">
            <span class="rp-sub-line">${esc(e.degree)}</span>
            <span class="rp-sub-line">${esc(e.location)}</span>
          </div>
          ${e.details ? `<div class="rp-details">${esc(e.details)}</div>` : ""}
        </div>`
      )
      .join("");
    if (!rows) return "";
    return `<div class="rp-section"><div class="rp-heading">Education</div>${rows}</div>`;
  }

  function renderExperience(items) {
    const filtered = items.filter((e) => e.title || e.company);
    if (!filtered.length) return "";
    const rows = filtered
      .map(
        (e) => `
        <div class="rp-entry">
          <div class="rp-row">
            <span class="rp-title-line">${esc(e.title)}</span>
            <span>${renderDateRange(e.start, e.end)}</span>
          </div>
          <div class="rp-row">
            <span class="rp-sub-line">${esc(e.company)}</span>
            <span class="rp-sub-line">${esc(e.location)}</span>
          </div>
          ${renderBullets(e.bullets)}
        </div>`
      )
      .join("");
    return `<div class="rp-section"><div class="rp-heading">Experience</div>${rows}</div>`;
  }

  function renderProjects(items) {
    const filtered = items.filter((p) => p.name);
    if (!filtered.length) return "";
    const rows = filtered
      .map(
        (p) => `
        <div class="rp-entry">
          <div class="rp-row">
            <span class="rp-title-line">${esc(p.name)}${p.tech ? ` <span class="rp-sub-line">- ${esc(p.tech)}</span>` : ""}</span>
            <span>${renderDateRange(p.start, p.end)}</span>
          </div>
          ${renderBullets(p.bullets)}
        </div>`
      )
      .join("");
    return `<div class="rp-section"><div class="rp-heading">Projects</div>${rows}</div>`;
  }

  function renderSkills(items) {
    const filtered = items.filter((s) => s.category || s.items);
    if (!filtered.length) return "";
    const rows = filtered
      .map(
        (s) => `<div class="rp-entry"><span class="rp-title-line">${esc(s.category)}:</span> ${esc(s.items)}</div>`
      )
      .join("");
    return `<div class="rp-section"><div class="rp-heading">Skills</div>${rows}</div>`;
  }

  function renderCertifications(items) {
    if (!items.length) return "";
    return `<div class="rp-section"><div class="rp-heading">Certifications</div><div class="rp-entry">${items
      .map(esc)
      .join(" &mdash; ")}</div></div>`;
  }

  function renderAwards(items) {
    const filtered = items.filter((a) => a.title);
    if (!filtered.length) return "";
    const rows = filtered
      .map(
        (a) => `
        <div class="rp-entry">
          <div class="rp-row">
            <span class="rp-title-line">${esc(a.title)}</span>
            <span>${esc(a.date)}</span>
          </div>
          <div class="rp-row">
            <span class="rp-sub-line">${esc(a.org)}</span>
            <span class="rp-sub-line">${esc(a.location)}</span>
          </div>
        </div>`
      )
      .join("");
    return `<div class="rp-section"><div class="rp-heading">Awards</div>${rows}</div>`;
  }

  function render() {
    const data = collectResumeData();

    preview.className = `resume-page template-${data.template}`;

    if (!data.name && !data.experience.length && !data.education.length) {
      preview.innerHTML = `<div class="empty-state">Fill in your details on the left, or import an existing resume PDF to get started.</div>`;
      return;
    }

    const html = `
      <div class="rp-header">
        ${data.name ? `<div class="rp-name">${esc(data.name)}</div>` : ""}
        ${data.title ? `<div class="rp-sub-line" style="margin-bottom:4px;">${esc(data.title)}</div>` : ""}
        <div class="rp-contact">${renderContactLine(data)}</div>
      </div>
      ${data.summary ? `<div class="rp-summary">${esc(data.summary)}</div>` : ""}
      ${renderEducation(data.education)}
      ${renderExperience(data.experience)}
      ${renderProjects(data.projects)}
      ${renderSkills(data.skills)}
      ${renderCertifications(data.certifications)}
      ${renderAwards(data.awards)}
    `;

    preview.innerHTML = html;
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 50);
  }

  // ---------- Persistence ----------

  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectResumeData()));
      } catch (e) {
        /* localStorage unavailable - not critical */
      }
    }, 300);
  }

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      populateForm(JSON.parse(raw));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- Events ----------

  document.addEventListener("input", () => {
    scheduleRender();
    persist();
  });
  document.addEventListener("change", () => {
    scheduleRender();
    persist();
  });

  resetBtn.addEventListener("click", () => {
    if (!confirm("Clear all fields and start over?")) return;
    localStorage.removeItem(STORAGE_KEY);
    form.reset();
    Object.keys(lists).forEach(clearList);
    document.getElementById("field-name").value = "";
    document.getElementById("field-title").value = "";
    document.getElementById("field-email").value = "";
    document.getElementById("field-phone").value = "";
    document.getElementById("field-location").value = "";
    document.getElementById("field-summary").value = "";
    document.getElementById("field-certifications").value = "";
    render();
  });

  printBtn.addEventListener("click", () => window.print());

  // ---------- Import ----------

  function setImportStatus(kind, text) {
    importStatus.hidden = false;
    importStatus.textContent = text;
    importStatus.className = `import-status is-${kind}`;
  }

  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;

    importStatus.hidden = true;
    showLoading(`Reading ${file.name}...`);

    try {
      const text = await window.extractPdfText(file);
      if (!text) {
        setImportStatus("error", "No extractable text found in that PDF (it may be a scanned image).");
        return;
      }

      showLoading("Asking Claude to map it into the template...");

      const res = await fetch(IMPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (!res.ok) {
        setImportStatus("error", body.error || "Import failed.");
        return;
      }
      populateForm(body.resume);
      scheduleRender();
      persist();
      setImportStatus("success", "Imported! Review the fields on the left and pick a template.");
    } catch (err) {
      setImportStatus("error", err.message || "Could not reach the import server.");
    } finally {
      hideLoading();
      importInput.value = "";
    }
  });

  // ---------- Init ----------

  if (!loadPersisted()) {
    addEntry("education", {});
    addEntry("experience", {});
  }
  render();
})();
