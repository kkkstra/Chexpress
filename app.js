const data = window.PRICE_DATA;
const carrierOrder = ["sf", "jd", "deppon"];
const carriers = carrierOrder
  .map((id) => data.carriers.find((carrier) => carrier.id === id))
  .filter(Boolean);
const sourceEntries = carriers.flatMap((carrier) => {
  if (!carrier.under20Rows) return [carrier];
  return [
    carrier,
    {
      id: `${carrier.id}-under20`,
      name: `${carrier.name}（小于20kg）`,
      color: carrier.color,
      formula: "sf-under20",
      source: carrier.under20Source,
      rows: carrier.under20Rows,
    },
  ];
});
const range = data.range;

const els = {
  provinceSelect: document.querySelector("#provinceSelect"),
  citySelect: document.querySelector("#citySelect"),
  unitToggle: document.querySelector("#unitToggle"),
  weightInput: document.querySelector("#weightInput"),
  chart: document.querySelector("#priceChart"),
  legend: document.querySelector("#legend"),
  currentWeight: document.querySelector("#currentWeight"),
  priceCards: document.querySelector("#priceCards"),
  sourceBtn: document.querySelector("#sourceBtn"),
  sourceDialog: document.querySelector("#sourceDialog"),
  sourceClose: document.querySelector("#sourceClose"),
  sourceTabs: document.querySelector("#sourceTabs"),
  sourceTable: document.querySelector("#sourceTable"),
  disclaimerDialog: document.querySelector("#disclaimerDialog"),
  disclaimerConfirm: document.querySelector("#disclaimerConfirm"),
};

const DISCLAIMER_KEY = "chexpress-disclaimer-confirmed-v1";

const state = {
  weightJin: 40,
  unit: "kg",
  locked: false,
  province: "湖北",
  city: "武汉市",
  sourceCarrierId: "sf",
};

const provinceGroups = data.chinaRegions;
init();

function init() {
  renderLegend();
  renderProvinceOptions();
  renderCityOptions();
  els.provinceSelect.value = state.province;
  els.citySelect.value = state.city;
  els.provinceSelect.addEventListener("change", () => {
    state.province = els.provinceSelect.value;
    const group = provinceGroups.find((item) => item.name === state.province);
    state.city = group?.cities[0] || "";
    renderCityOptions();
    render();
  });
  els.citySelect.addEventListener("change", () => {
    state.city = els.citySelect.value;
    render();
  });
  els.unitToggle.addEventListener("click", () => {
    state.unit = state.unit === "kg" ? "jin" : "kg";
    configureWeightInput();
    render();
  });
  els.weightInput.addEventListener("change", () => {
    const next = readWeightInput();
    if (next.status !== "valid") {
      restoreWeightInput();
      return;
    }
    state.weightJin = valueToJin(next.value);
    state.locked = true;
    render();
  });
  els.weightInput.addEventListener("input", () => {
    const next = readWeightInput();
    if (next.status !== "valid") return;
    state.weightJin = valueToJin(next.value);
    state.locked = true;
    render({ preserveWeightInput: true });
  });
  els.sourceBtn.addEventListener("click", openSourceDialog);
  els.sourceClose.addEventListener("click", closeSourceDialog);
  els.sourceDialog.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-source]")) closeSourceDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.sourceDialog.hidden) closeSourceDialog();
  });
  window.addEventListener("resize", render);
  renderSourceTabs();
  configureWeightInput();
  render();
  showDisclaimerIfNeeded();
}

function renderProvinceOptions() {
  els.provinceSelect.textContent = "";
  provinceGroups.forEach((provinceGroup) => {
    const option = document.createElement("option");
    option.value = provinceGroup.name;
    option.textContent = provinceGroup.name;
    els.provinceSelect.append(option);
  });
}

function renderCityOptions() {
  const group = provinceGroups.find((item) => item.name === state.province) || provinceGroups[0];
  els.citySelect.textContent = "";
  group.cities.forEach((city) => {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    els.citySelect.append(option);
  });
  els.citySelect.value = state.city;
}

function renderLegend() {
  els.legend.innerHTML = carriers
    .map(
      (carrier) => `
        <span class="legend-item" style="color:${carrier.color}">
          <span class="legend-dot"></span>${carrier.name}
        </span>
      `,
    )
    .join("");
}

function render(options = {}) {
  state.weightJin = clampJin(state.weightJin);
  if (!options.preserveWeightInput) restoreWeightInput();
  els.unitToggle.textContent = unitDisplayLabel();
  els.unitToggle.setAttribute("aria-label", `切换到${state.unit === "kg" ? "斤" : "千克"}`);
  els.weightInput.setAttribute("aria-label", `重量（${unitDisplayLabel()}）`);
  els.currentWeight.textContent = formatWeight(state.weightJin);

  const region = getSelectedRegion();
  const matches = carriers.map((carrier) => {
    const match = findBestRow(carrier, region);
    const under20Match = carrier.under20Rows
      ? findBestRow({ ...carrier, rows: carrier.under20Rows }, region)
      : null;
    return {
      carrier,
      row: match?.row || null,
      under20Row: under20Match?.row || null,
    };
  });
  matches.forEach((match) => {
    match.values = buildSeries(match);
  });

  renderCards(matches);
  renderChart(matches);
}

function buildSeries(match) {
  const points = [];
  for (let jin = minJin(); jin <= maxJin(); jin += 1) {
    points.push({ jin, value: jinToValue(jin), price: calculateMatchPrice(match, jin) });
  }
  return points;
}

function calculateMatchPrice(match, jin) {
  if (match.carrier.id === "sf" && jin < 40) {
    return match.under20Row ? calculateSfUnder20Price(match.under20Row, jin) : null;
  }
  return match.row ? calculatePrice(match.carrier, match.row, jin) : null;
}

function calculatePrice(carrier, row, jin) {
  if (carrier.formula === "deppon-20-60") {
    if (jin <= row.firstJin) return row.firstPrice;
    if (jin < row.pivotJin) return row.firstPrice + (jin - row.firstJin) * row.rateToPivot;
    return row.pivotPrice + (jin - row.pivotJin) * row.rateAfterPivot;
  }

  if (jin <= row.firstJin) return row.firstPrice;
  if (jin <= row.thresholdJin) return row.firstPrice + (jin - row.firstJin) * row.rate1;
  return row.firstPrice + (row.thresholdJin - row.firstJin) * row.rate1 + (jin - row.thresholdJin) * row.rate2;
}

function calculateSfUnder20Price(row, jin) {
  const kg = jin / 2;
  if (kg <= row.firstKg) return row.firstPrice;
  if (kg <= 3) return row.firstPrice + (kg - row.firstKg) * row.rateTo3;

  if (Number.isFinite(row.rate3To15)) {
    if (kg <= 15) return row.firstPrice + 2 * row.rateTo3 + (kg - 3) * row.rate3To15;
    return row.firstPrice + 2 * row.rateTo3 + 12 * row.rate3To15 + (kg - 15) * row.rateAfter15;
  }

  return row.firstPrice + 2 * row.rateTo3 + (kg - 3) * row.rate3To20;
}

function renderCards(matches) {
  els.priceCards.innerHTML = matches
    .map((match) => {
      const price = calculateMatchPrice(match, state.weightJin);
      const classes = `price-card${price == null ? " no-data" : ""}`;
      return `
        <article class="${classes}" style="color:${match.carrier.color}">
          <header>
            <h2>${match.carrier.name}</h2>
            <div class="price">${price == null ? "无数据" : `¥${formatMoney(price)}`}</div>
          </header>
        </article>
      `;
    })
    .join("");
}

function renderChart(matches) {
  const svg = els.chart;
  const width = Math.max(320, Math.round(svg.getBoundingClientRect().width || 960));
  const height = Math.max(280, Math.round(svg.getBoundingClientRect().height || 520));
  const compact = width < 560;
  const margin = compact
    ? { top: 34, right: 18, bottom: 46, left: 48 }
    : { top: 32, right: 28, bottom: 54, left: 66 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xTickY = height - margin.bottom + (compact ? 24 : 28);
  const axisTitleY = compact ? 18 : 18;

  const allPrices = matches.flatMap((match) => match.values.map((point) => point.price).filter(Number.isFinite));
  const yMaxRaw = Math.max(10, ...allPrices);
  const yMax = Math.ceil((yMaxRaw * 1.08) / 20) * 20;
  const selectedInChartRange = isJinInChartRange(state.weightJin);
  const selectedX = selectedInChartRange ? xScale(jinToValue(state.weightJin), margin.left, plotW) : null;

  const grid = [];
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i += 1) {
    const value = (yMax / yTicks) * i;
    const y = yScale(value, yMax, margin.top, plotH);
    grid.push(`<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"></line>`);
    grid.push(`<text class="tick-label" x="${margin.left - 12}" y="${y + 4}" text-anchor="end">${Math.round(value)}</text>`);
  }

  const xTicks = state.unit === "kg" ? [0.5, 20, 40, 60, 80] : [1, 40, 80, 120, 160];
  xTicks.forEach((value) => {
    const x = xScale(value, margin.left, plotW);
    grid.push(`<line class="grid-line" x1="${x}" x2="${x}" y1="${margin.top}" y2="${height - margin.bottom}"></line>`);
    grid.push(`<text class="tick-label" x="${x}" y="${xTickY}" text-anchor="middle">${formatTick(value)}</text>`);
  });

  const paths = matches
    .map(({ carrier, values }) => {
      const d = toPath(values, yMax, margin, plotW, plotH);
      return d ? `<path class="price-line" d="${d}" stroke="${carrier.color}"></path>` : "";
    })
    .join("");

  const dots = matches
    .map(({ carrier, values }) => {
      if (!selectedInChartRange) return "";
      const point = values.find((item) => item.jin === state.weightJin);
      if (!point || !Number.isFinite(point.price)) return "";
      const x = xScale(point.value, margin.left, plotW);
      const y = yScale(point.price, yMax, margin.top, plotH);
      return `<circle class="focus-dot" cx="${x}" cy="${y}" r="5.5" fill="${carrier.color}"></circle>`;
    })
    .join("");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
    ${grid.join("")}
    <line class="axis-line" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
    <line class="axis-line" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
    <text class="axis-label" x="${width - margin.right}" y="${axisTitleY}" text-anchor="end">重量 ${unitLabel()}</text>
    <text class="axis-label" x="${margin.left}" y="${axisTitleY}">总运费 ¥</text>
    ${paths}
    ${selectedInChartRange ? `<line class="focus-line" x1="${selectedX}" x2="${selectedX}" y1="${margin.top}" y2="${height - margin.bottom}"></line>` : ""}
    ${dots}
    <rect class="hit-area" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}"></rect>
  `;

  const hitArea = svg.querySelector(".hit-area");
  hitArea.addEventListener("pointermove", (event) => {
    if (state.locked) return;
    state.weightJin = jinFromPointer(event, svg, margin.left, plotW);
    render();
  });
  hitArea.addEventListener("pointerdown", (event) => {
    state.weightJin = jinFromPointer(event, svg, margin.left, plotW);
    state.locked = !state.locked;
    render();
  });
}

function openSourceDialog() {
  els.sourceDialog.hidden = false;
  renderSourceTable();
}

function closeSourceDialog() {
  els.sourceDialog.hidden = true;
}

function showDisclaimerIfNeeded() {
  if (isDisclaimerConfirmed()) return;
  els.disclaimerDialog.hidden = false;
  els.disclaimerConfirm.addEventListener(
    "click",
    () => {
      confirmDisclaimer();
      els.disclaimerDialog.hidden = true;
    },
    { once: true },
  );
}

function isDisclaimerConfirmed() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DISCLAIMER_KEY) === "1";
  } catch {
    return false;
  }
}

function confirmDisclaimer() {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(DISCLAIMER_KEY, "1");
  } catch {
    // Ignore storage failures so the user can still use the offline page.
  }
}

function renderSourceTabs() {
  els.sourceTabs.innerHTML = sourceEntries
    .map(
      (entry) => `
        <button class="source-tab" type="button" role="tab" data-carrier="${entry.id}" aria-selected="${entry.id === state.sourceCarrierId}">
          ${entry.name}
        </button>
      `,
    )
    .join("");
  els.sourceTabs.querySelectorAll(".source-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.sourceCarrierId = button.dataset.carrier;
      renderSourceTabs();
      renderSourceTable();
    });
  });
}

function renderSourceTable() {
  const carrier = sourceEntries.find((item) => item.id === state.sourceCarrierId) || sourceEntries[0];
  const rows = carrier.rows;
  const rowSpanMap = buildRowSpanMap(rows, carrier);
  if (carrier.formula === "sf-under20") {
    els.sourceTable.innerHTML = `
      <thead><tr><th>目的省</th><th>目的地</th><th>价格首重（1kg）</th><th>续重（≤3kg）</th><th>续重（3&lt;重量≤15kg）</th><th>续重（&gt;15kg）</th><th>续重（3&lt;重量≤20kg）</th><th>续重（&gt;20kg）</th></tr></thead>
      <tbody>
        ${rows
          .map((row, index) => {
            const group = rowSpanMap.get(index);
            return `
              <tr>
                ${group ? `<td rowspan="${group.span}" class="province-cell">${escapeHtml(group.label)}</td>` : ""}
                <td>${escapeHtml(row.label)}</td>
                <td>${formatSourceCell(row.firstPrice)}</td>
                <td>${formatSourceCell(row.rateTo3)}</td>
                <td>${formatSourceCell(row.rate3To15)}</td>
                <td>${formatSourceCell(row.rateAfter15)}</td>
                <td>${formatSourceCell(row.rate3To20)}</td>
                <td>${formatSourceCell(row.rateAfter20)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    `;
    return;
  }

  if (carrier.formula === "deppon-20-60") {
    els.sourceTable.innerHTML = `
      <thead><tr><th>目的地</th><th>首重20斤</th><th>续重1（20-60斤）</th><th>60斤价格</th><th>续重2（60斤以上）</th></tr></thead>
      <tbody>
        ${rows
          .map((row, index) => {
            const group = rowSpanMap.get(index);
            return `
              <tr>
                ${group ? `<td rowspan="${group.span}" class="province-cell">${escapeHtml(group.label)}</td>` : ""}
                <td>${row.firstPrice}</td>
                <td>${row.rateToPivot}</td>
                <td>${row.pivotPrice}</td>
                <td>${row.rateAfterPivot}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    `;
    return;
  }

  const header = firstToThresholdHeader(rows);
  els.sourceTable.innerHTML = `
    <thead><tr><th>目的省</th><th>目的地</th><th>${header.first}</th><th>${header.rate1}</th><th>${header.rate2}</th></tr></thead>
    <tbody>
      ${rows
        .map((row, index) => {
          const group = rowSpanMap.get(index);
          return `
            <tr>
              ${group ? `<td rowspan="${group.span}" class="province-cell">${escapeHtml(group.label)}</td>` : ""}
              <td>${escapeHtml(row.label)}</td>
              <td>${row.firstPrice}</td>
              <td>${row.rate1}</td>
              <td>${row.rate2}</td>
            </tr>
          `;
        })
        .join("")}
    </tbody>
  `;
}

function formatSourceCell(value) {
  return Number.isFinite(value) ? value : "—";
}

function firstToThresholdHeader(rows) {
  const firstJin = rows[0]?.firstJin || "";
  const thresholdJin = rows[0]?.thresholdJin || "";
  return {
    first: `首重${firstJin}斤`,
    rate1: `续重1（${firstJin}-${thresholdJin}斤）`,
    rate2: `续重2（${thresholdJin}斤以上）`,
  };
}

function toPath(values, yMax, margin, plotW, plotH) {
  let d = "";
  let drawing = false;
  values.forEach((point) => {
    if (!Number.isFinite(point.price)) {
      drawing = false;
      return;
    }
    const x = xScale(point.value, margin.left, plotW);
    const y = yScale(point.price, yMax, margin.top, plotH);
    d += `${drawing ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    drawing = true;
  });
  return d.trim();
}

function findBestRow(carrier, region) {
  let best = null;
  carrier.rows.forEach((row) => {
    if (!getProvinces(row).includes(region.province)) return;
    const score = scoreRow(row, region);
    if (!best || score > best.score) {
      best = { row, score };
    }
  });

  if (!best || best.score <= 0) return null;
  return { row: best.row };
}

function scoreRow(row, region) {
  let score = 1;
  const aliases = uniqueTerms([row.label, ...(row.aliases || [])]);
  const excludes = uniqueTerms(row.excludes || []);
  const regionTerms = uniqueTerms([region.label, ...(region.terms || [])]);
  const regionExcludes = uniqueTerms(region.excludes || []);

  if (row.label === region.label) score += 30;
  if (row.scope === "all") score += 5;
  if (row.scope === "other") score += 4;
  if (row.scope === "exclude") score += 3;

  aliases.forEach((alias) => {
    regionTerms.forEach((term) => {
      if (isTermMatch(alias, term)) {
        score += 10;
        if (row.scope === "specific") score += 5;
      }
    });
  });

  excludes.forEach((term) => {
    regionTerms.forEach((regionTerm) => {
      if (isTermMatch(term, regionTerm)) score -= 40;
    });
  });

  aliases.forEach((alias) => {
    regionExcludes.forEach((excluded) => {
      if (isTermMatch(alias, excluded)) score -= 30;
    });
  });

  return score;
}

function jinFromPointer(event, svg, left, plotW) {
  const rect = svg.getBoundingClientRect();
  const ratio = (event.clientX - rect.left - left * (rect.width / Number(svg.viewBox.baseVal.width))) / (plotW * (rect.width / Number(svg.viewBox.baseVal.width)));
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const value = minValue() + boundedRatio * (maxValue() - minValue());
  return valueToJin(value);
}

function xScale(value, left, plotW) {
  return left + ((value - minValue()) / (maxValue() - minValue())) * plotW;
}

function yScale(value, yMax, top, plotH) {
  return top + (1 - value / yMax) * plotH;
}

function configureWeightInput() {
  els.weightInput.min = String(minValue());
  els.weightInput.step = state.unit === "kg" ? "0.5" : "1";
}

function readWeightInput() {
  const raw = els.weightInput.value.trim();
  const normalized = raw === "" || raw === "." ? "0" : raw;
  if (!/^\d+(\.\d*)?$/.test(normalized)) return { status: "invalid" };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { status: "invalid" };
  return { status: "valid", value };
}

function restoreWeightInput() {
  els.weightInput.value = formatWeightInput(jinToValue(state.weightJin));
}

function getSelectedRegion() {
  return {
    province: state.province,
    label: state.city,
    city: state.city,
    scope: "city",
    terms: uniqueTerms([state.province, state.city, cleanTerm(state.city)]),
    excludes: [],
  };
}

function minJin() {
  return 1;
}

function maxJin() {
  return range.maxKg * 2;
}

function minValue() {
  return state.unit === "kg" ? minJin() / 2 : minJin();
}

function maxValue() {
  return state.unit === "kg" ? maxJin() / 2 : maxJin();
}

function unitLabel() {
  return state.unit === "kg" ? "kg" : "斤";
}

function unitDisplayLabel() {
  return state.unit === "kg" ? "千克" : "斤";
}

function valueToJin(value) {
  const raw = state.unit === "kg" ? value * 2 : value;
  return clampJin(raw);
}

function jinToValue(jin) {
  return state.unit === "kg" ? jin / 2 : jin;
}

function clampJin(value) {
  if (!Number.isFinite(value)) return minJin();
  return Math.max(minJin(), Math.ceil(value - 0.0000001));
}

function isJinInChartRange(jin) {
  return jin >= minJin() && jin <= maxJin();
}

function formatWeight(jin) {
  return `${formatWeightInput(jinToValue(jin))} ${unitLabel()}`;
}

function formatWeightInput(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTick(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getProvinces(row) {
  return row.provinces || [row.province];
}

function uniqueTerms(values) {
  const set = new Set();
  values
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[、，,\/；;。\s]+/))
    .map(cleanTerm)
    .filter((value) => value.length >= 2 && !["全境", "全部", "其它", "其他"].includes(value))
    .forEach((value) => set.add(value));
  return [...set];
}

function cleanTerm(value) {
  return String(value)
    .replace(/^除/, "")
    .replace(/(省|市|地区|自治州|自治县|蒙古自治州|藏族自治州|布依族苗族自治州|土家族苗族自治州|哈尼族彝族自治州|回族自治区|壮族自治区|维吾尔自治区|特别行政区)$/g, "")
    .trim();
}

function isTermMatch(a, b) {
  const left = cleanTerm(a);
  const right = cleanTerm(b);
  return left === right || left.includes(right) || right.includes(left);
}

function formatMoney(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

function buildRowSpanMap(rows, carrier) {
  const map = new Map();
  let index = 0;
  while (index < rows.length) {
    const label = sourceProvinceLabel(rows[index], carrier);
    let span = 1;
    while (index + span < rows.length && sourceProvinceLabel(rows[index + span], carrier) === label) {
      span += 1;
    }
    map.set(index, { label, span });
    index += span;
  }
  return map;
}

function sourceProvinceLabel(row, carrier) {
  if (carrier.formula === "deppon-20-60") return row.label;
  return row.province;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
