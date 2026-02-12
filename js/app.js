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

function groupLabel(record, questName) {
  const pbText = record.pb ? "PB" : "No-PB";
  return `${questName ?? "(unknown quest)"} — ${record.category} — ${record.meta} — ${pbText}`;
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

    if (gk !== lastGroup) {
      tbodyRows.push(
        `<tr class="group-label"><td colspan="${headers.length}">${esc(groupLabel(record, questName))}</td></tr>`
      );
      tbodyRows.push(
        `<tr class="group-divider"><td colspan="${headers.length}"><div class="bar"></div></td></tr>`
      );
      lastGroup = gk;
      lastRecordIdWithinGroup = null;
    }

    const isFirstRowForThisRecord = record.id !== lastRecordIdWithinGroup;
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

/**
 * Filter logic:
 * - selectedPlayerIds is a Set of player_id numbers
 * - show records that include ANY of the selected players
 */
function filterRecordsByPlayersAny(records, playerRecords, selectedPlayerIds) {
  if (!selectedPlayerIds.size) return records;

  const recordIds = new Set();
  for (const pr of playerRecords) {
    if (selectedPlayerIds.has(pr.player_id)) recordIds.add(pr.record_id);
  }
  return records.filter((r) => recordIds.has(r.id));
}

/* ------------------ Multi-select typeahead UI ------------------ */

function normalize(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

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

(async () => {
  const statusEl = document.getElementById("status");
  const outputEl = document.getElementById("output");

  const playerInput = document.getElementById("playerInput");
  const suggestionsEl = document.getElementById("suggestions");
  const chipsEl = document.getElementById("chips");

  try {
    const [records, quests, playerRecords, players] = await Promise.all([
      loadJSON("./data/records.json"),
      loadJSON("./data/quests.json"),
      loadJSON("./data/player_records.json"),
      loadJSON("./data/players.json"),
    ]);

    const questById = buildIdMap(quests);
    const playerById = buildIdMap(players);

    // Search list for typeahead
    const playersByName = [...players]
      .map(p => ({ id: Number(p.id), name: p.name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Selected players
    const selectedIds = new Set();

    function renderChips() {
      chipsEl.innerHTML = "";
      for (const pid of selectedIds) {
        const name = playerById.get(pid)?.name ?? `Player ${pid}`;
        const chip = createChip(name, () => {
          selectedIds.delete(pid);
          renderChips();
          render();
        });
        chipsEl.appendChild(chip);
      }
    }

    function addPlayerById(pid) {
      if (!pid || selectedIds.has(pid)) return;
      selectedIds.add(pid);
      renderChips();
      render();
    }

    function render() {
      const filtered = filterRecordsByPlayersAny(records, playerRecords, selectedIds);

      const label = selectedIds.size
        ? `Filtered to ${filtered.length} records for ${[...selectedIds]
            .map(id => playerById.get(id)?.name ?? `Player ${id}`)
            .join(", ")}`
        : `Showing ${filtered.length} records`;

      statusEl.textContent = label;
      outputEl.innerHTML = renderGroupedTable(filtered, questById, playerRecords, playerById, null);
    }

    function buildSuggestionList(query) {
      const q = normalize(query);
      if (!q) return "";

      const matches = [];
      for (const p of playersByName) {
        if (selectedIds.has(p.id)) continue;
        if (normalize(p.name).includes(q)) matches.push(p);
        if (matches.length >= 10) break;
      }

      if (!matches.length) return "";

      return matches
        .map(p => `<div class="suggestion" data-id="${p.id}">${esc(p.name)}</div>`)
        .join("");
    }

    // Events: typing shows suggestions
    playerInput.addEventListener("input", () => {
      const html = buildSuggestionList(playerInput.value);
      showSuggestions(suggestionsEl, html);
    });

    // Click suggestion to add
    suggestionsEl.addEventListener("click", (e) => {
      const el = e.target.closest(".suggestion");
      if (!el) return;
      const pid = Number(el.getAttribute("data-id"));
      addPlayerById(pid);
      playerInput.value = "";
      showSuggestions(suggestionsEl, "");
      playerInput.focus();
    });

    // Enter tries to add best match
    playerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const q = normalize(playerInput.value);
        if (!q) return;

        const best = playersByName.find(p => !selectedIds.has(p.id) && normalize(p.name).includes(q));
        if (best) {
          addPlayerById(best.id);
          playerInput.value = "";
          showSuggestions(suggestionsEl, "");
        }
      } else if (e.key === "Escape") {
        showSuggestions(suggestionsEl, "");
      }
    });

    // Click outside closes suggestions
    document.addEventListener("click", (e) => {
      if (e.target === playerInput || suggestionsEl.contains(e.target)) return;
      showSuggestions(suggestionsEl, "");
    });

    // Initial render
    render();
  } catch (err) {
    statusEl.textContent = "Failed to load data";
    outputEl.textContent = String(err);
    console.error(err);
  }
})();
