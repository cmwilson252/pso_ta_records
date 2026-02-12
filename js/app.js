// js/app.js

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

function buildIdMap(items) {
  const m = new Map();
  for (const it of items) m.set(it.id, it);
  return m;
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalize(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

// seconds -> 7'34 Remaining (if negative) or 6'00 (if positive)
function formatTime(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const ss = String(s).padStart(2, "0");
  if (n < 0) return `${m}'${ss} Remaining`;
  return `${m}'${ss}`;
}

function groupKey(record, questName) {
  return [
    questName ?? "(unknown quest)",
    record.meta ?? "",
    record.category ?? "",
    record.pb ? "PB" : "NoPB",
  ].join("||");
}

function renderGroupedTable(records, questById, playerRecords, playerById, limitN) {
  const headers = ["Quest", "Meta", "Category", "PB", "Time", "Rank", "Player", "Class", "POV"];
  const selected = (limitN ? records.slice(0, limitN) : records);

  const joinedRows = [];
  for (const record of selected) {
    const questName = questById.get(record.quest_id)?.name;

    const prsForRecord = playerRecords
      .filter((pr) => pr.record_id === record.id)
      .sort((a, b) => a.id - b.id);

    if (prsForRecord.length === 0) {
      joinedRows.push({
        record,
        questName,
        pr: null,
        playerName: "(none found)",
        cls: "",
        pov: "",
      });
      continue;
    }

    for (const pr of prsForRecord) {
      const p = playerById.get(pr.player_id);
      joinedRows.push({
        record,
        questName,
        pr,
        playerName: p?.name ?? `(unknown player ${pr.player_id})`,
        cls: pr.pso_class ?? "",
        pov: pr.pov ?? "",
      });
    }
  }

  joinedRows.sort((a, b) => {
    const ka = groupKey(a.record, a.questName);
    const kb = groupKey(b.record, b.questName);
    if (ka !== kb) return ka.localeCompare(kb);

    if (a.record.id !== b.record.id) {
      if (a.record.rank !== b.record.rank) return a.record.rank - b.record.rank;
      if (a.record.time !== b.record.time) return a.record.time - b.record.time;
      return a.record.id - b.record.id;
    }

    const aid = a.pr?.id ?? 0;
    const bid = b.pr?.id ?? 0;
    if (aid !== bid) return aid - bid;
    return a.playerName.localeCompare(b.playerName);
  });

  const thead = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;

  let lastGroup = null;
  let lastRecordIdWithinGroup = null;
  const tbodyRows = [];

  for (const row of joinedRows) {
    const record = row.record;
    const questName = row.questName;
    const pbText = record.pb ? "PB" : "No-PB";
    const gk = groupKey(record, questName);

    // Group divider (blue line only)
    if (gk !== lastGroup) {
      tbodyRows.push(
        `<tr class="group-divider"><td colspan="${headers.length}"><div class="bar"></div></td></tr>`
      );
      lastGroup = gk;
      lastRecordIdWithinGroup = null;
    }

    const isFirstRowForThisRecord = record.id !== lastRecordIdWithinGroup;

    // Thin divider between entries within the same group
    if (isFirstRowForThisRecord && lastRecordIdWithinGroup !== null) {
      tbodyRows.push(
        `<tr class="entry-divider"><td colspan="${headers.length}"><div class="thin"></div></td></tr>`
      );
    }

    if (isFirstRowForThisRecord) lastRecordIdWithinGroup = record.id;

    const povHTML =
      row.pov && /^https?:\/\//i.test(row.pov)
        ? `<a href="${esc(row.pov)}" target="_blank" rel="noopener noreferrer">${esc(row.pov)}</a>`
        : esc(row.pov);

    const dataRow = {
      Quest: isFirstRowForThisRecord ? (questName ?? "(unknown quest)") : "",
      Meta: isFirstRowForThisRecord ? record.meta : "",
      Category: isFirstRowForThisRecord ? record.category : "",
      PB: isFirstRowForThisRecord ? pbText : "",
      Time: isFirstRowForThisRecord ? formatTime(record.time) : "",
      Rank: isFirstRowForThisRecord ? record.rank : "",
      Player: row.playerName,
      Class: row.cls,
      POV: povHTML,
    };

    const tds = headers.map((h) => {
      if (h === "POV") return `<td>${dataRow[h]}</td>`;
      return `<td>${esc(dataRow[h])}</td>`;
    }).join("");

    tbodyRows.push(`<tr>${tds}</tr>`);
  }

  return `<table class="pivot">${thead}<tbody>${tbodyRows.join("")}</tbody></table>`;
}

/* ---------- Multi-select typeahead (reusable) ---------- */

function createChip(name, onRemove) {
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = name;

  const x = document.createElement("button");
  x.type = "button";
  x.className = "chip-x";
  x.textContent = "×";
  x.addEventListener("click", onRemove);

  chip.appendChild(x);
  return chip;
}

function showSuggestions(box, itemsHtml) {
  if (!itemsHtml) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = itemsHtml;
}

function wireMultiTypeahead({
  inputEl,
  suggestionsEl,
  chipsEl,
  // items: [{key, label}] where key is stored in the selected Set
  items,
  selectedSet,
  onChange,
  placeholderLabel,
}) {
  function renderChips() {
    chipsEl.innerHTML = "";
    for (const key of selectedSet) {
      const label = items.find((it) => it.key === key)?.label ?? `${placeholderLabel} ${key}`;
      const chip = createChip(label, () => {
        selectedSet.delete(key);
        renderChips();
        onChange();
      });
      chipsEl.appendChild(chip);
    }
  }

  function addKey(key) {
    if (key == null || selectedSet.has(key)) return;
    selectedSet.add(key);
    renderChips();
    onChange();
  }

  function buildSuggestionList(query) {
    const q = normalize(query);
    if (!q) return "";

    const matches = [];
    for (const it of items) {
      if (selectedSet.has(it.key)) continue;
      if (normalize(it.label).includes(q)) matches.push(it);
      if (matches.length >= 10) break;
    }

    if (!matches.length) return "";

    return matches
      .map((it) => `<div class="suggestion" data-key="${esc(it.key)}">${esc(it.label)}</div>`)
      .join("");
  }

  inputEl.addEventListener("input", () => {
    showSuggestions(suggestionsEl, buildSuggestionList(inputEl.value));
  });

  suggestionsEl.addEventListener("click", (e) => {
    const el = e.target.closest(".suggestion");
    if (!el) return;
    const key = el.getAttribute("data-key");
    addKey(key);
    inputEl.value = "";
    showSuggestions(suggestionsEl, "");
    inputEl.focus();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = normalize(inputEl.value);
      if (!q) return;

      const best = items.find((it) => !selectedSet.has(it.key) && normalize(it.label).includes(q));
      if (best) {
        addKey(best.key);
        inputEl.value = "";
        showSuggestions(suggestionsEl, "");
      }
    } else if (e.key === "Escape") {
      showSuggestions(suggestionsEl, "");
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target === inputEl || suggestionsEl.contains(e.target)) return;
    showSuggestions(suggestionsEl, "");
  });

  renderChips();

  return { renderChips };
}

/* ---------- Filtering ---------- */

function filterRecords(records, playerRecords, selectedPlayerIds, selectedClasses, metaVal, countVal, pbVal) {
  // Precompute sets of record_id that match players/classes
  let allowedByPlayers = null;
  let allowedByClasses = null;

  if (selectedPlayerIds.size) {
    allowedByPlayers = new Set();
    for (const pr of playerRecords) {
      if (selectedPlayerIds.has(String(pr.player_id))) allowedByPlayers.add(pr.record_id);
    }
  }

  if (selectedClasses.size) {
    allowedByClasses = new Set();
    for (const pr of playerRecords) {
      const cls = normalize(pr.pso_class);
      if (selectedClasses.has(cls)) allowedByClasses.add(pr.record_id);
    }
  }

  return records.filter((r) => {
    if (metaVal && String(r.meta) !== metaVal) return false;
    if (countVal && String(r.category) !== countVal) return false;
    if (pbVal !== "" && String(Number(Boolean(r.pb))) !== pbVal) return false;

    if (allowedByPlayers && !allowedByPlayers.has(r.id)) return false;
    if (allowedByClasses && !allowedByClasses.has(r.id)) return false;

    return true;
  });
}

function fillSelect(selectEl, values) {
  // keep first option "All"
  const first = selectEl.firstElementChild;
  selectEl.innerHTML = "";
  if (first) selectEl.appendChild(first);

  const sorted = [...values].sort((a, b) => String(a).localeCompare(String(b)));
  for (const v of sorted) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = String(v);
    selectEl.appendChild(opt);
  }
}

(async () => {
  const statusEl = document.getElementById("status");
  const outputEl = document.getElementById("output");

  // Filter elements
  const metaSelect = document.getElementById("metaSelect");
  const countSelect = document.getElementById("countSelect");
  const pbSelect = document.getElementById("pbSelect");

  // Player typeahead elements
  const playerInput = document.getElementById("playerInput");
  const playerSuggestions = document.getElementById("playerSuggestions");
  const playerChips = document.getElementById("playerChips");

  // Class typeahead elements
  const classInput = document.getElementById("classInput");
  const classSuggestions = document.getElementById("classSuggestions");
  const classChips = document.getElementById("classChips");

  try {
    const [records, quests, playerRecords, players] = await Promise.all([
      loadJSON("./data/records.json"),
      loadJSON("./data/quests.json"),
      loadJSON("./data/player_records.json"),
      loadJSON("./data/players.json"),
    ]);

    const questById = buildIdMap(quests);
    const playerById = buildIdMap(players);

    // Build meta/count unique sets from records
    const metas = new Set(records.map((r) => r.meta).filter((v) => v != null && v !== ""));
    const counts = new Set(records.map((r) => r.category).filter((v) => v != null && v !== ""));

    fillSelect(metaSelect, metas);
    fillSelect(countSelect, counts);

    // Build typeahead items
    const playerItems = [...players]
      .map((p) => ({ key: String(p.id), label: p.name ?? "" }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Classes come from player_records (pso_class)
    const classSet = new Set();
    for (const pr of playerRecords) {
      const c = normalize(pr.pso_class);
      if (c) classSet.add(c);
    }
    const classItems = [...classSet]
      .map((c) => ({ key: c, label: c }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Selected filters
    const selectedPlayerIds = new Set(); // string ids
    const selectedClasses = new Set();   // normalized class strings

    function render() {
      const metaVal = metaSelect.value;
      const countVal = countSelect.value;
      const pbVal = pbSelect.value; // "" | "1" | "0"

      const filtered = filterRecords(
        records,
        playerRecords,
        selectedPlayerIds,
        selectedClasses,
        metaVal,
        countVal,
        pbVal
      );

      const parts = [];
      if (selectedPlayerIds.size) {
        parts.push(
          `Players: ${[...selectedPlayerIds]
            .map((id) => playerById.get(Number(id))?.name ?? id)
            .join(", ")}`
        );
      }
      if (metaVal) parts.push(`Meta: ${metaVal}`);
      if (countVal) parts.push(`Count: ${countVal}`);
      if (pbVal !== "") parts.push(`PB: ${pbVal === "1" ? "PB" : "No-PB"}`);
      if (selectedClasses.size) parts.push(`Class: ${[...selectedClasses].join(", ")}`);

      statusEl.textContent = parts.length
        ? `Showing ${filtered.length} records (${parts.join(" • ")})`
        : `Showing ${filtered.length} records`;

      outputEl.innerHTML = renderGroupedTable(filtered, questById, playerRecords, playerById, null);
    }

    // Wire up typeaheads
    wireMultiTypeahead({
      inputEl: playerInput,
      suggestionsEl: playerSuggestions,
      chipsEl: playerChips,
      items: playerItems,
      selectedSet: selectedPlayerIds,
      onChange: render,
      placeholderLabel: "Player",
    });

    wireMultiTypeahead({
      inputEl: classInput,
      suggestionsEl: classSuggestions,
      chipsEl: classChips,
      items: classItems,
      selectedSet: selectedClasses,
      onChange: render,
      placeholderLabel: "Class",
    });

    // Dropdown changes
    metaSelect.addEventListener("change", render);
    countSelect.addEventListener("change", render);
    pbSelect.addEventListener("change", render);

    // Initial render
    render();
  } catch (err) {
    statusEl.textContent = "Failed to load data";
    outputEl.textContent = String(err);
    console.error(err);
  }
})();
