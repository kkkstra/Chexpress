const data = window.PRICE_DATA;
const carrierOrder = ["sf", "jd", "deppon"];
const carriers = carrierOrder
  .map((id) => data.carriers.find((carrier) => carrier.id === id))
  .filter(Boolean);
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
    state.weightJin = valueToJin(Number(els.weightInput.value));
    state.locked = true;
    render();
  });
  els.weightInput.addEventListener("input", () => {
    const next = Number(els.weightInput.value);
    if (Number.isFinite(next)) {
      state.weightJin = valueToJin(next);
      state.locked = true;
      render();
    }
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

function render() {
  state.weightJin = clampJin(state.weightJin);
  els.weightInput.value = formatWeightInput(jinToValue(state.weightJin));
  els.unitToggle.textContent = unitDisplayLabel();
  els.unitToggle.setAttribute("aria-label", `切换到${state.unit === "kg" ? "斤" : "千克"}`);
  els.weightInput.setAttribute("aria-label", `重量（${unitDisplayLabel()}）`);
  els.currentWeight.textContent = formatWeight(state.weightJin);

  const region = getSelectedRegion();
  const matches = carriers.map((carrier) => {
    const match = findBestRow(carrier, region);
    return {
      carrier,
      row: match?.row || null,
      values: buildSeries(carrier, match?.row || null),
    };
  });

  renderCards(matches);
  renderChart(matches);
}

function buildSeries(carrier, row) {
  const points = [];
  for (let jin = minJin(); jin <= maxJin(); jin += 1) {
    points.push({ jin, value: jinToValue(jin), price: row ? calculatePrice(carrier, row, jin) : null });
  }
  return points;
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

function renderCards(matches) {
  els.priceCards.innerHTML = matches
    .map(({ carrier, row }) => {
      const price = row ? calculatePrice(carrier, row, state.weightJin) : null;
      const classes = `price-card${row ? "" : " no-data"}`;
      return `
        <article class="${classes}" style="color:${carrier.color}">
          <header>
            <h2>${carrier.name}</h2>
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
  const selectedX = xScale(jinToValue(state.weightJin), margin.left, plotW);

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
    <line class="focus-line" x1="${selectedX}" x2="${selectedX}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
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
  els.sourceTabs.innerHTML = carriers
    .map(
      (carrier) => `
        <button class="source-tab" type="button" role="tab" data-carrier="${carrier.id}" aria-selected="${carrier.id === state.sourceCarrierId}">
          ${carrier.name}
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
  const carrier = carriers.find((item) => item.id === state.sourceCarrierId) || carriers[0];
  const rows = carrier.rows;
  const rowSpanMap = buildRowSpanMap(rows, carrier);
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
      if (isTermMatch(alias, term)) score += 10;
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
  const value = minValue() + ratio * (maxValue() - minValue());
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
  els.weightInput.max = String(maxValue());
  els.weightInput.step = state.unit === "kg" ? "0.5" : "1";
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
  return Math.max(minJin(), Math.min(maxJin(), Math.round(value)));
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
