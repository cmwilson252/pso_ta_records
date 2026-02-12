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

  // Build joined rows: one row per player_record (or placeholder)
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

  // Sort by group, then by rank/time, then keep players grouped per record
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

  const tbody = `<tbody>${tbodyRows.join("")}</tbody>`;
  return `<table class="pivot">${thead}${tbody}</table>`;
}

function populatePlayerDropdown(selectEl, players) {
  // Sort by name, then fill options
  const sorted = [...players].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  for (const p of sorted) {
    const opt = document.createElement("option");
    opt.value = String(p.id); // store player_id
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  }
}

function filterRecordsByPlayer(records, playerRecords, playerId) {
  if (!playerId) return records;

  const pid = Number(playerId);
  const recordIds = new Set(
    playerRecords
      .filter((pr) => pr.player_id === pid)
      .map((pr) => pr.record_id)
  );

  return records.filter((r) => recordIds.has(r.id));
}

(async () => {
  const statusEl = document.getElementById("status");
  const outputEl = document.getElementById("output");
  const playerSelect = document.getElementById("playerFilter");

  try {
    const [records, quests, playerRecords, players] = await Promise.all([
      loadJSON("./data/records.json"),
      loadJSON("./data/quests.json"),
      loadJSON("./data/player_records.json"),
      loadJSON("./data/players.json"),
    ]);

    const questById = buildIdMap(quests);
    const playerById = buildIdMap(players);

    // Populate dropdown
    populatePlayerDropdown(playerSelect, players);

    // Render function
    const render = () => {
      const selectedPlayerId = playerSelect.value; // "" means all
      const filtered = filterRecordsByPlayer(records, playerRecords, selectedPlayerId);

      const label = selectedPlayerId
        ? `Filtered to ${filtered.length} records for ${playerById.get(Number(selectedPlayerId))?.name ?? "player"}`
        : `Showing ${filtered.length} records`;

      statusEl.textContent = label;

      // For now, don’t limit; if you want 10/50/etc, pass a number as last argument
      outputEl.innerHTML = renderGroupedTable(filtered, questById, playerRecords, playerById, null);
    };

    // Initial render + on change
    playerSelect.addEventListener("change", render);
    render();
  } catch (err) {
    statusEl.textContent = "Failed to load data";
    outputEl.textContent = String(err);
    console.error(err);
  }
})();
