
'use strict';

/* =========================================================
   Global seed for reproducible mixed-logit draws
   ========================================================= */

const RANDOM_SEED = 123456789; // change only when you want a new fixed panel of draws

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// seeded PRNG instance
let prng = mulberry32(RANDOM_SEED);

/* =========================================================
   Core state
   ========================================================= */

const state = {
  settings: {
    horizonYears: 1,
    population: 1000000,
    currencyLabel: 'local currency units',
    vslMetric: 'vsl',
    vslValue: 5400000
  },
  config: null,
  costs: null,
  derived: null,
  scenarios: [],
  // v2.0 additions
  pinnedScenarioIds: [],
  policyQuestion: 'none', // 'none', 'strict_vs_lenient', 'max_support_bcr', 'max_bcr_support', 'compare_countries'
  policyConstraints: {
    minSupport: null,
    minBcr: null
  },
  uncertainty: {
    livesLow: null,
    livesMid: null,
    livesHigh: null
  }
};

/* =========================================================
   Mixed logit coefficient means and SDs
   (ASC Policy A, ASC Opt-out, scope, exemptions, coverage, lives)
   ========================================================= */

const mxlCoefs = {
  AU: {
    mild: {
      ascPolicyA: 0.464,
      ascOptOut: -0.572,
      scopeAll: -0.319,
      exMedRel: -0.157,
      exMedRelPers: -0.267,
      cov70: 0.171,
      cov90: 0.158,
      lives: 0.072
    },
    severe: {
      ascPolicyA: 0.535,
      ascOptOut: -0.694,
      scopeAll: 0.190,
      exMedRel: -0.181,
      exMedRelPers: -0.305,
      cov70: 0.371,
      cov90: 0.398,
      lives: 0.079
    }
  },
  IT: {
    mild: {
      ascPolicyA: 0.625,
      ascOptOut: -0.238,
      scopeAll: -0.276,
      exMedRel: -0.176,
      exMedRelPers: -0.289,
      cov70: 0.185,
      cov90: 0.148,
      lives: 0.039
    },
    severe: {
      ascPolicyA: 0.799,
      ascOptOut: -0.463,
      scopeAll: 0.174,
      exMedRel: -0.178,
      exMedRelPers: -0.207,
      cov70: 0.305,
      cov90: 0.515,
      lives: 0.045
    }
  },
  FR: {
    mild: {
      ascPolicyA: 0.899,
      ascOptOut: 0.307,
      scopeAll: -0.160,
      exMedRel: -0.121,
      exMedRelPers: -0.124,
      cov70: 0.232,
      cov90: 0.264,
      lives: 0.049
    },
    severe: {
      ascPolicyA: 0.884,
      ascOptOut: 0.083,
      scopeAll: -0.019,
      exMedRel: -0.192,
      exMedRelPers: -0.247,
      cov70: 0.267,
      cov90: 0.398,
      lives: 0.052
    }
  }
};

const mxlSDs = {
  AU: {
    mild: {
      ascPolicyA: 1.104,
      ascOptOut: 5.340,
      scopeAll: 1.731,
      exMedRel: 0.443,
      exMedRelPers: 1.254,
      cov70: 0.698,
      cov90: 1.689,
      lives: 0.101
    },
    severe: {
      ascPolicyA: 1.019,
      ascOptOut: 5.021,
      scopeAll: 1.756,
      exMedRel: 0.722,
      exMedRelPers: 1.252,
      cov70: 0.641,
      cov90: 1.548,
      lives: 0.103
    }
  },
  IT: {
    mild: {
      ascPolicyA: 1.560,
      ascOptOut: 4.748,
      scopeAll: 1.601,
      exMedRel: 0.718,
      exMedRelPers: 1.033,
      cov70: 0.615,
      cov90: 1.231,
      lives: 0.080
    },
    severe: {
      ascPolicyA: 1.518,
      ascOptOut: 4.194,
      scopeAll: 1.448,
      exMedRel: 0.575,
      exMedRelPers: 1.082,
      cov70: 0.745,
      cov90: 1.259,
      lives: 0.082
    }
  },
  FR: {
    mild: {
      ascPolicyA: 1.560,
      ascOptOut: 4.138,
      scopeAll: 1.258,
      exMedRel: 0.818,
      exMedRelPers: 0.972,
      cov70: 0.550,
      cov90: 1.193,
      lives: 0.081
    },
    severe: {
      ascPolicyA: 1.601,
      ascOptOut: 3.244,
      scopeAll: 1.403,
      exMedRel: 0.690,
      exMedRelPers: 1.050,
      cov70: 0.548,
      cov90: 1.145,
      lives: 0.085
    }
  }
};

/* =========================================================
   Evidence-based / stylised per-capita cost defaults
   Values are approximate, per 1 million people, per year,
   in local currency units, varying by country and category.
   ========================================================= */

const COST_DEFAULTS_PER_MILLION = {
  AU: {
    itSystems: 1200000,
    comms: 800000,
    enforcement: 1800000,
    compensation: 2200000,
    admin: 800000,
    other: 500000
  },
  FR: {
    itSystems: 1000000,
    comms: 700000,
    enforcement: 1500000,
    compensation: 1800000,
    admin: 700000,
    other: 400000
  },
  IT: {
    itSystems: 900000,
    comms: 600000,
    enforcement: 1400000,
    compensation: 1600000,
    admin: 600000,
    other: 400000
  }
};

const COST_OUTBREAK_MULTIPLIER = {
  mild: 0.8,
  severe: 1.3
};

const NUM_MXL_DRAWS = 1000;
const coeffNames = [
  'ascPolicyA',
  'ascOptOut',
  'scopeAll',
  'exMedRel',
  'exMedRelPers',
  'cov70',
  'cov90',
  'lives'
];

const benefitMetricMeta = {
  vsl: {
    label: 'Value of statistical life (per life saved)',
    defaults: {
      AU: 5400000,
      FR: 3000000,
      IT: 2800000
    }
  },
  vsly: {
    label: 'Value of a statistical life-year (per life-year gained)',
    defaults: {
      AU: 230000,
      FR: 100000,
      IT: 80000
    }
  },
  qalys: {
    label: 'Monetary value per QALY gained',
    defaults: {
      AU: 50000,
      FR: 40000,
      IT: 30000
    }
  },
  healthsys: {
    label: 'Average health system cost savings per life saved',
    defaults: {
      AU: 100000,
      FR: 80000,
      IT: 60000
    }
  }
};

let standardNormalDraws = [];
let bcrChart = null;
let supportChart = null;
let mrsChart = null;
let pinnedRadarChart = null;

/* =========================================================
   Random draws, deterministic set per session
   ========================================================= */

function randStdNormal() {
  // Box-Muller using the seeded PRNG
  let u = 0;
  let v = 0;
  while (u === 0) u = prng();
  while (v === 0) v = prng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateStandardNormalDraws() {
  standardNormalDraws = new Array(NUM_MXL_DRAWS);
  for (let r = 0; r < NUM_MXL_DRAWS; r++) {
    const obj = {};
    coeffNames.forEach(name => {
      obj[name] = randStdNormal();
    });
    standardNormalDraws[r] = obj;
  }
}

/* =========================================================
   Predicted support from mixed logit
   ========================================================= */

function computeSupportFromMXL(config) {
  if (!config) return null;
  const country = config.country || 'AU';
  const outbreak = config.outbreak || 'mild';
  const countryCoefs = mxlCoefs[country];
  const countrySDs = mxlSDs[country];
  if (!countryCoefs || !countrySDs) return null;

  const mean = countryCoefs[outbreak];
  const sd = countrySDs[outbreak];
  if (!mean || !sd) return null;

  const livesPer100k = config.livesPer100k || 0;
  const scope = config.scope || 'highrisk';
  const exemptions = config.exemptions || 'medical';
  const coverage = config.coverage || 0.5;

  let probSum = 0;

  for (let r = 0; r < NUM_MXL_DRAWS; r++) {
    const z = standardNormalDraws[r];

    const beta = {
      ascPolicyA: mean.ascPolicyA + (sd.ascPolicyA || 0) * z.ascPolicyA,
      ascOptOut: mean.ascOptOut + (sd.ascOptOut || 0) * z.ascOptOut,
      scopeAll: mean.scopeAll + (sd.scopeAll || 0) * z.scopeAll,
      exMedRel: mean.exMedRel + (sd.exMedRel || 0) * z.exMedRel,
      exMedRelPers: mean.exMedRelPers + (sd.exMedRelPers || 0) * z.exMedRelPers,
      cov70: mean.cov70 + (sd.cov70 || 0) * z.cov70,
      cov90: mean.cov90 + (sd.cov90 || 0) * z.cov90,
      lives: mean.lives + (sd.lives || 0) * z.lives
    };

    let uMandate = beta.ascPolicyA;
    let uOptOut = beta.ascOptOut;

    // Scope
    if (scope === 'all') {
      uMandate += beta.scopeAll;
    }

    // Exemptions
    if (exemptions === 'medrel') {
      uMandate += beta.exMedRel;
    } else if (exemptions === 'medrelpers') {
      uMandate += beta.exMedRelPers;
    }

    // Coverage (50% is reference)
    if (coverage === 0.7) {
      uMandate += beta.cov70;
    } else if (coverage === 0.9) {
      uMandate += beta.cov90;
    }

    // Lives saved attribute
    uMandate += beta.lives * livesPer100k;

    // Two-alternative logit: mandate vs opt-out
    const diff = uMandate - uOptOut;
    const pMandate = 1 / (1 + Math.exp(-diff));
    probSum += pMandate;
  }

  return probSum / NUM_MXL_DRAWS;
}

/* =========================================================
   Benefit metric helpers
   ========================================================= */

function getCurrentCountryCode() {
  const cfgSelect = document.getElementById('cfg-country');
  const fallback = cfgSelect ? cfgSelect.value : 'AU';
  return (state.config && state.config.country) || fallback || 'AU';
}

function updateBenefitMetricUI(options = { resetValue: false }) {
  const metricSelect = document.getElementById('setting-vsl-metric');
  const valueInput = document.getElementById('setting-vsl');
  const labelEl = document.querySelector('label[for="setting-vsl"]');
  if (!metricSelect || !valueInput || !labelEl) return;

  const metric = metricSelect.value || 'vsl';
  const country = getCurrentCountryCode();
  const meta = benefitMetricMeta[metric];

  if (meta) {
    const baseText = meta.label + ' ';
    const childNodes = Array.from(labelEl.childNodes);
    if (childNodes.length && childNodes[0].nodeType === Node.TEXT_NODE) {
      childNodes[0].nodeValue = baseText;
    } else {
      labelEl.insertBefore(document.createTextNode(baseText), labelEl.firstChild);
    }

    if (options.resetValue && meta.defaults && meta.defaults[country] != null) {
      valueInput.value = meta.defaults[country];
    }
  }
}

/* =========================================================
   Evidence-based default costs
   ========================================================= */

function computeEvidenceBasedCosts(settings, config) {
  if (!config) return null;
  const country = config.country || 'AU';
  const outbreak = config.outbreak || 'mild';
  const perMillion = COST_DEFAULTS_PER_MILLION[country] || COST_DEFAULTS_PER_MILLION['AU'];
  const multiplier = COST_OUTBREAK_MULTIPLIER[outbreak] || 1.0;
  const pop = settings.population || 0;
  const horizon = settings.horizonYears || 1;

  const scale = (pop / 1000000) * horizon * multiplier;

  return {
    itSystems: Math.round(perMillion.itSystems * scale),
    comms: Math.round(perMillion.comms * scale),
    enforcement: Math.round(perMillion.enforcement * scale),
    compensation: Math.round(perMillion.compensation * scale),
    admin: Math.round(perMillion.admin * scale),
    other: Math.round(perMillion.other * scale)
  };
}

/* =========================================================
   Initialisation
   ========================================================= */

function init() {
  initTabs();
  initRangeDisplay();
  initTooltips();
  generateStandardNormalDraws();
  updateSettingsFromForm();
  setupBenefitMetricHandlers();
  loadFromStorage();
  attachEventHandlers();
  applyUncertaintyFromForm(); // initialise uncertainty state from any defaults
  updateAll();
}

document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   Tabs
   ========================================================= */

function initTabs() {
  const links = document.querySelectorAll('.tab-link');
  const tabs = document.querySelectorAll('.tab-content');

  links.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      links.forEach(b => b.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(tabId);
      if (target) target.classList.add('active');
    });
  });
}

/* Range display for lives slider */

function initRangeDisplay() {
  const range = document.getElementById('cfg-lives');
  const span = document.getElementById('cfg-lives-display');
  if (!range || !span) return;

  const update = () => {
    span.textContent = range.value;
  };
  range.addEventListener('input', update);
  update();
}

/* Tooltips */

function initTooltips() {
  const tooltip = document.getElementById('globalTooltip');
  if (!tooltip) return;

  const hide = () => {
    tooltip.classList.add('tooltip-hidden');
    tooltip.textContent = '';
  };

  const show = el => {
    const rect = el.getBoundingClientRect();
    tooltip.textContent = el.getAttribute('data-tooltip') || '';
    tooltip.classList.remove('tooltip-hidden');
    const top = rect.bottom + window.scrollY + 8;
    const left = rect.left + window.scrollX;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  };

  document.querySelectorAll('[data-tooltip]').forEach(el => {
    if (!el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '0');
    }
    if (!el.getAttribute('aria-label')) {
      el.setAttribute('aria-label', el.getAttribute('data-tooltip') || 'More information');
    }

    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('focus', () => show(el));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
    el.addEventListener('keydown', evt => {
      if (evt.key === 'Escape') hide();
    });
  });

  window.addEventListener('scroll', hide);
}

/* Benefit metric handlers */

function setupBenefitMetricHandlers() {
  const metricSelect = document.getElementById('setting-vsl-metric');
  if (!metricSelect) return;

  metricSelect.addEventListener('change', () => {
    updateBenefitMetricUI({ resetValue: true });
    updateSettingsFromForm();
    if (state.config) {
      state.derived = computeDerived(state.settings, state.config, state.costs);
    }
    updateAll();
  });

  updateBenefitMetricUI({ resetValue: false });
}

/* =========================================================
   Storage
   ========================================================= */

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('mandeValScenariosFuture');
    if (raw) {
      state.scenarios = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Could not load scenarios from storage', e);
  }

  try {
    const pinnedRaw = localStorage.getItem('mandeValPinnedScenariosFuture');
    if (pinnedRaw) {
      const arr = JSON.parse(pinnedRaw);
      if (Array.isArray(arr)) state.pinnedScenarioIds = arr;
    }
  } catch (e) {
    console.warn('Could not load pinned scenarios from storage', e);
  }
}

function saveToStorage() {
  try {
    localStorage.setItem('mandeValScenariosFuture', JSON.stringify(state.scenarios));
  } catch (e) {
    console.warn('Could not save scenarios to storage', e);
  }

  try {
    localStorage.setItem('mandeValPinnedScenariosFuture', JSON.stringify(state.pinnedScenarioIds));
  } catch (e) {
    console.warn('Could not save pinned scenarios to storage', e);
  }
}

/* =========================================================
   Event handlers
   ========================================================= */

function attachEventHandlers() {
  const btnApplySettings = document.getElementById('btn-apply-settings');
  const btnApplyConfig = document.getElementById('btn-apply-config');
  const btnSaveScenario = document.getElementById('btn-save-scenario');
  const btnApplyCosts = document.getElementById('btn-apply-costs');
  const btnSaveScenarioCosts = document.getElementById('btn-save-scenario-costs');
  const btnLoadDefaultCosts = document.getElementById('btn-load-default-costs');

  if (btnApplySettings) {
    btnApplySettings.addEventListener('click', () => {
      applySettingsFromForm();
    });
  }

  if (btnApplyConfig) {
    btnApplyConfig.addEventListener('click', () => {
      applyConfigFromForm();
      updateAll();
      showToast('Configuration applied.', 'success');
    });
  }

  if (btnSaveScenario) {
    btnSaveScenario.addEventListener('click', () => {
      saveScenario();
    });
  }

  if (btnApplyCosts) {
    btnApplyCosts.addEventListener('click', () => {
      applyCostsFromForm();
      updateAll();
      showToast('Costs applied.', 'success');
    });
  }

  if (btnSaveScenarioCosts) {
    btnSaveScenarioCosts.addEventListener('click', () => {
      if (!state.config) {
        showToast('Apply a configuration before saving a scenario.', 'warning');
        return;
      }
      applyCostsFromForm();
      updateAll();
      saveScenario();
    });
  }

  if (btnLoadDefaultCosts) {
    btnLoadDefaultCosts.addEventListener('click', () => {
      if (!state.config) {
        showToast(
          'Apply a configuration first so default costs can be tailored to a country and scenario.',
          'warning'
        );
        return;
      }
      const defaults = computeEvidenceBasedCosts(state.settings, state.config);
      if (!defaults) {
        showToast('Could not compute default costs.', 'error');
        return;
      }
      const itEl = document.getElementById('cost-it-systems');
      const commsEl = document.getElementById('cost-communications');
      const enfEl = document.getElementById('cost-enforcement');
      const compEl = document.getElementById('cost-compensation');
      const adminEl = document.getElementById('cost-admin');
      const otherEl = document.getElementById('cost-other');

      if (itEl) itEl.value = defaults.itSystems;
      if (commsEl) commsEl.value = defaults.comms;
      if (enfEl) enfEl.value = defaults.enforcement;
      if (compEl) compEl.value = defaults.compensation;
      if (adminEl) adminEl.value = defaults.admin;
      if (otherEl) otherEl.value = defaults.other;

      applyCostsFromForm();
      updateAll();
      showToast('Country- and scenario-specific default costs loaded.', 'success');
    });
  }

  const btnCopyBriefing = document.getElementById('btn-copy-briefing');
  if (btnCopyBriefing) {
    btnCopyBriefing.addEventListener('click', () => {
      copyFromTextarea('scenario-briefing-text');
    });
  }

  const btnCopyBriefingTemplate = document.getElementById('btn-copy-briefing-template');
  if (btnCopyBriefingTemplate) {
    btnCopyBriefingTemplate.addEventListener('click', () => {
      copyFromTextarea('briefing-template');
    });
  }

  const btnCopyAiPrompt = document.getElementById('btn-copy-ai-prompt');
  if (btnCopyAiPrompt) {
    btnCopyAiPrompt.addEventListener('click', () => {
      copyFromTextarea('ai-prompt');
    });
  }

  const btnOpenAi = document.getElementById('btn-open-ai');
  if (btnOpenAi) {
    btnOpenAi.addEventListener('click', () => {
      window.open('https://copilot.microsoft.com/', '_blank');
    });
  }

  // Export buttons
  const btnExportExcel = document.getElementById('btn-export-excel');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnExportPdf = document.getElementById('btn-export-pdf');
  const btnExportWord = document.getElementById('btn-export-word');
  const btnClearStorage = document.getElementById('btn-clear-storage');

  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', () => exportScenarios('excel'));
  }
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => exportScenarios('csv'));
  }
  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', () => exportScenarios('pdf'));
  }
  if (btnExportWord) {
    btnExportWord.addEventListener('click', () => exportScenarios('word'));
  }
  if (btnClearStorage) {
    btnClearStorage.addEventListener('click', () => {
      state.scenarios = [];
      state.pinnedScenarioIds = [];
      saveToStorage();
      rebuildScenariosTable();
      updateScenarioBriefingCurrent();
      updateAiPrompt();
      updatePinnedDashboard();
      showToast('All saved scenarios cleared from this browser.', 'warning');
    });
  }

  // Presentation mode toggle
  const btnPresentation = document.getElementById('btn-presentation-mode');
  if (btnPresentation) {
    btnPresentation.addEventListener('click', () => {
      document.body.classList.toggle('presentation-mode');
      const on = document.body.classList.contains('presentation-mode');
      btnPresentation.textContent = on ? 'Exit presentation mode' : 'Presentation mode';
    });
  }

  // Policy question guided mode
  const policySelect = document.getElementById('policy-question-select');
  if (policySelect) {
    policySelect.addEventListener('change', () => {
      state.policyQuestion = policySelect.value || 'none';
      updatePolicyGuidance();
      updateAll();
    });
  }
  const inputSupportMin = document.getElementById('policy-support-min');
  if (inputSupportMin) {
    inputSupportMin.addEventListener('input', () => {
      const v = parseFloat(inputSupportMin.value);
      state.policyConstraints.minSupport = isFinite(v) ? v : null;
      updateAll();
    });
  }
  const inputBcrMin = document.getElementById('policy-bcr-min');
  if (inputBcrMin) {
    inputBcrMin.addEventListener('input', () => {
      const v = parseFloat(inputBcrMin.value);
      state.policyConstraints.minBcr = isFinite(v) ? v : null;
      updateAll();
    });
  }

  // Uncertainty inputs
  ['unc-lives-low', 'unc-lives-central', 'unc-lives-high'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        applyUncertaintyFromForm();
        updateAll();
      });
    }
  });
}

/* =========================================================
   Settings & configuration
   ========================================================= */

function updateSettingsFromForm() {
  const horizonEl = document.getElementById('setting-horizon');
  const popEl = document.getElementById('setting-population');
  const currencyEl = document.getElementById('setting-currency');
  const metricEl = document.getElementById('setting-vsl-metric');
  const vslEl = document.getElementById('setting-vsl');

  const horizon = parseFloat(horizonEl ? horizonEl.value : '1') || 1;
  const pop = parseFloat(popEl ? popEl.value : '0') || 0;
  const currency = currencyEl && currencyEl.value ? currencyEl.value : 'local currency units';
  const metric = metricEl && metricEl.value ? metricEl.value : 'vsl';
  const vslVal = parseFloat(vslEl ? vslEl.value : '0') || 0;

  state.settings = {
    horizonYears: horizon,
    population: pop,
    currencyLabel: currency,
    vslMetric: metric,
    vslValue: vslVal
  };
}

function applySettingsFromForm() {
  updateSettingsFromForm();
  if (state.config) {
    state.derived = computeDerived(state.settings, state.config, state.costs);
  }
  updateAll();
  showToast('Settings applied.', 'success');
}

function inferCurrencyLabel(country) {
  if (country === 'AU') return 'AUD';
  if (country === 'FR' || country === 'IT') return 'EUR';
  return 'local currency units';
}

function applyConfigFromForm() {
  const countryEl = document.getElementById('cfg-country');
  const outbreakEl = document.getElementById('cfg-outbreak');
  const scopeEl = document.getElementById('cfg-scope');
  const exemptionsEl = document.getElementById('cfg-exemptions');
  const coverageEl = document.getElementById('cfg-coverage');
  const livesEl = document.getElementById('cfg-lives');

  const country = countryEl ? countryEl.value : 'AU';
  const outbreak = outbreakEl ? outbreakEl.value : 'mild';
  const scope = scopeEl ? scopeEl.value : 'highrisk';
  const exemptions = exemptionsEl ? exemptionsEl.value : 'medical';
  const coverage = parseFloat(coverageEl ? coverageEl.value : '0.5');
  const livesPer100k = parseFloat(livesEl ? livesEl.value : '0') || 0;

  // Auto-set currency label if still generic
  const currencyInput = document.getElementById('setting-currency');
  if (currencyInput) {
    const currentLabel = (currencyInput.value || '').trim();
    if (currentLabel === '' || currentLabel === 'local currency units') {
      currencyInput.value = inferCurrencyLabel(country);
    }
  }

  updateSettingsFromForm(); // refresh state.settings with potential new currency

  state.config = {
    country,
    outbreak,
    scope,
    exemptions,
    coverage,
    livesPer100k
  };

  // Refresh benefit metric UI with the new country context
  updateBenefitMetricUI({ resetValue: false });

  state.derived = computeDerived(state.settings, state.config, state.costs);
}

function applyCostsFromForm() {
  const itEl = document.getElementById('cost-it-systems');
  const commsEl = document.getElementById('cost-communications');
  const enfEl = document.getElementById('cost-enforcement');
  const compEl = document.getElementById('cost-compensation');
  const adminEl = document.getElementById('cost-admin');
  const otherEl = document.getElementById('cost-other');

  const itSystems = parseFloat(itEl ? itEl.value : '0') || 0;
  const comms = parseFloat(commsEl ? commsEl.value : '0') || 0;
  const enforcement = parseFloat(enfEl ? enfEl.value : '0') || 0;
  const compensation = parseFloat(compEl ? compEl.value : '0') || 0;
  const admin = parseFloat(adminEl ? adminEl.value : '0') || 0;
  const other = parseFloat(otherEl ? otherEl.value : '0') || 0;

  state.costs = {
    itSystems,
    comms,
    enforcement,
    compensation,
    admin,
    other
  };

  state.derived = computeDerived(state.settings, state.config, state.costs);
}

/* =========================================================
   Uncertainty engine
   ========================================================= */

function applyUncertaintyFromForm() {
  const lowEl = document.getElementById('unc-lives-low');
  const midEl = document.getElementById('unc-lives-central');
  const highEl = document.getElementById('unc-lives-high');

  const low = parseFloat(lowEl ? lowEl.value : '');
  const mid = parseFloat(midEl ? midEl.value : '');
  const high = parseFloat(highEl ? highEl.value : '');

  state.uncertainty = {
    livesLow: isFinite(low) ? low : null,
    livesMid: isFinite(mid) ? mid : null,
    livesHigh: isFinite(high) ? high : null
  };
}

function computeUncertaintySummary() {
  if (!state.config || !state.derived) return null;
  const { livesLow, livesMid, livesHigh } = state.uncertainty;
  if (livesLow == null || livesMid == null || livesHigh == null) return null;

  const cfg = state.config;
  const settings = state.settings;
  const costs = state.costs;

  const cfgLow = { ...cfg, livesPer100k: livesLow };
  const cfgMid = { ...cfg, livesPer100k: livesMid };
  const cfgHigh = { ...cfg, livesPer100k: livesHigh };

  const dLow = computeDerived(settings, cfgLow, costs);
  const dMid = computeDerived(settings, cfgMid, costs);
  const dHigh = computeDerived(settings, cfgHigh, costs);

  return {
    low: dLow,
    mid: dMid,
    high: dHigh
  };
}

function updateUncertaintySummary() {
  const livesEl = document.getElementById('unc-summary-lives');
  const supportEl = document.getElementById('unc-summary-support');
  const bcrEl = document.getElementById('unc-summary-bcr');

  if (!livesEl && !supportEl && !bcrEl) return;

  if (!state.config || !state.derived) {
    if (livesEl) livesEl.textContent = 'Enter low/central/high lives-saved assumptions to see ranges.';
    if (supportEl) supportEl.textContent = 'Pending';
    if (bcrEl) bcrEl.textContent = 'Pending';
    return;
  }

  const summary = computeUncertaintySummary();
  if (!summary) {
    if (livesEl)
      livesEl.textContent =
        'Set low, central and high values for expected lives saved per 100,000 to see uncertainty ranges.';
    if (supportEl) supportEl.textContent = 'Pending';
    if (bcrEl) bcrEl.textContent = 'Pending';
    return;
  }

  const cur = state.settings.currencyLabel;

  const minLives = Math.min(summary.low.livesTotal, summary.mid.livesTotal, summary.high.livesTotal);
  const maxLives = Math.max(summary.low.livesTotal, summary.mid.livesTotal, summary.high.livesTotal);

  const supports = [
    (summary.low.support || 0) * 100,
    (summary.mid.support || 0) * 100,
    (summary.high.support || 0) * 100
  ];
  const minSupp = Math.min(...supports);
  const maxSupp = Math.max(...supports);

  const bcrs = [summary.low.bcr, summary.mid.bcr, summary.high.bcr].filter(v => v != null && isFinite(v));
  const minBcr = bcrs.length ? Math.min(...bcrs) : null;
  const maxBcr = bcrs.length ? Math.max(...bcrs) : null;

  if (livesEl) {
    livesEl.textContent = `Total lives saved could range roughly from ${minLives.toFixed(
      1
    )} to ${maxLives.toFixed(1)} lives in the exposed population.`;
  }

  if (supportEl) {
    supportEl.textContent = `Under your low/central/high assumptions, model-based support ranges from about ${formatPercent(
      minSupp
    )} to ${formatPercent(maxSupp)}.`;
  }

  if (bcrEl) {
    if (minBcr == null) {
      bcrEl.textContent =
        'Benefit-cost ratios cannot be summarised because implementation costs are not yet entered or are zero.';
    } else {
      bcrEl.textContent = `Benefit-cost ratios could range from around ${minBcr.toFixed(
        2
      )} to ${maxBcr.toFixed(2)} based on your low/central/high lives-saved assumptions. Interpretation should reflect this uncertainty.`;
    }
  }
}

/* =========================================================
   Derived metrics
   ========================================================= */

function computeDerived(settings, config, costs) {
  if (!config) return null;

  const pop = settings.population || 0;
  const vsl = settings.vslValue || 0;
  const livesPer100k = config.livesPer100k || 0;

  const livesTotal = (livesPer100k / 100000) * pop;
  const benefitMonetary = livesTotal * vsl;

  const costTotal = costs
    ? (costs.itSystems || 0) +
      (costs.comms || 0) +
      (costs.enforcement || 0) +
      (costs.compensation || 0) +
      (costs.admin || 0) +
      (costs.other || 0)
    : 0;

  const netBenefit = benefitMonetary - costTotal;
  const bcr = costTotal > 0 ? benefitMonetary / costTotal : null;

  const support = computeSupportFromMXL(config);

  return {
    livesTotal,
    benefitMonetary,
    costTotal,
    netBenefit,
    bcr,
    support
  };
}

/* =========================================================
   Updating the UI
   ========================================================= */

function updateAll() {
  if (state.config && !state.derived) {
    state.derived = computeDerived(state.settings, state.config, state.costs);
  }

  updateConfigSummary();
  updateCostSummary();
  updateResultsSummary();
  rebuildScenariosTable();
  updateBriefingTemplate();
  updateAiPrompt();
  updateScenarioBriefingCurrent();
  updatePinnedDashboard();
  updateUncertaintySummary();
  updatePolicyGuidance();
}

function updateConfigSummary() {
  const elCountry = document.getElementById('summary-country');
  const elOutbreak = document.getElementById('summary-outbreak');
  const elScope = document.getElementById('summary-scope');
  const elExemptions = document.getElementById('summary-exemptions');
  const elCoverage = document.getElementById('summary-coverage');
  const elLives = document.getElementById('summary-lives');
  const elSupport = document.getElementById('summary-support');
  const elHeadline = document.getElementById('headlineRecommendation');

  if (!state.config || !state.derived) {
    if (elCountry) elCountry.textContent = 'Not set';
    if (elOutbreak) elOutbreak.textContent = 'Not set';
    if (elScope) elScope.textContent = 'Not set';
    if (elExemptions) elExemptions.textContent = 'Not set';
    if (elCoverage) elCoverage.textContent = 'Not set';
    if (elLives) elLives.textContent = 'Not set';
    if (elSupport) elSupport.textContent = 'Pending';
    if (elHeadline) {
      elHeadline.textContent =
        'No configuration applied yet. Configure country, outbreak scenario and design, then click "Apply configuration" to see a summary.';
    }
    updateStatusChips(null, null);
    return;
  }

  const c = state.config;
  const d = state.derived;

  if (elCountry) elCountry.textContent = countryLabel(c.country);
  if (elOutbreak) elOutbreak.textContent = outbreakLabel(c.outbreak);
  if (elScope) elScope.textContent = scopeLabel(c.scope);
  if (elExemptions) elExemptions.textContent = exemptionsLabel(c.exemptions);
  if (elCoverage) elCoverage.textContent = coverageLabel(c.coverage);
  if (elLives) elLives.textContent = `${c.livesPer100k.toFixed(1)} per 100,000`;
  if (elSupport) elSupport.textContent = formatPercent((d.support || 0) * 100);

  if (elHeadline) {
    const supp = (d.support || 0) * 100;
    const bcr = d.bcr;
    const cur = state.settings.currencyLabel;

    let rating;
    if (supp >= 70 && bcr && bcr >= 1) {
      rating =
        'This mandate option combines high predicted public support with a favourable benefit-cost profile given the current assumptions.';
    } else if (supp >= 60 && bcr && bcr >= 1) {
      rating =
        'This mandate option has broadly favourable support and a positive benefit-cost profile, but it still involves important trade offs.';
    } else if (supp < 50 && (!bcr || bcr < 1)) {
      rating =
        'This mandate option has limited predicted support and a weak benefit-cost profile. It may be difficult to justify without additional supporting measures.';
    } else {
      rating =
        'This mandate option involves trade offs between public support and the economic valuation of lives saved. It warrants careful deliberation.';
    }

    const costText =
      d.costTotal > 0
        ? `Indicative implementation cost is about ${formatCurrency(d.costTotal, cur)} over the selected horizon.`
        : 'Implementation costs have not yet been entered, so the benefit-cost profile is incomplete.';

    elHeadline.textContent =
      `${rating} Predicted public support is approximately ${formatPercent(supp)}. ` +
      `The monetary valuation of lives saved is about ${formatCurrency(d.benefitMonetary, cur)}. ${costText}`;
  }

  updateStatusChips(state.config, state.derived);
}

function updateCostSummary() {
  const elTotal = document.getElementById('summary-cost-total');
  const elMain = document.getElementById('summary-cost-main');
  const cur = state.settings.currencyLabel;

  if (!state.costs) {
    if (elTotal) elTotal.textContent = 'Pending';
    if (elMain) elMain.textContent = 'Pending';
    return;
  }

  const c = state.costs;
  const components = [
    { key: 'itSystems', label: 'Digital systems & infrastructure', value: c.itSystems || 0 },
    { key: 'comms', label: 'Communications & public information', value: c.comms || 0 },
    { key: 'enforcement', label: 'Enforcement & compliance', value: c.enforcement || 0 },
    { key: 'compensation', label: 'Adverse-event monitoring & compensation', value: c.compensation || 0 },
    { key: 'admin', label: 'Administration & programme management', value: c.admin || 0 },
    { key: 'other', label: 'Other mandate-specific costs', value: c.other || 0 }
  ];

  const total = components.reduce((acc, x) => acc + x.value, 0);
  let main = components[0];
  components.forEach(comp => {
    if (comp.value > main.value) main = comp;
  });

  if (elTotal) elTotal.textContent = total > 0 ? formatCurrency(total, cur) : 'Not yet entered';
  if (elMain) elMain.textContent = total > 0 ? `${main.label} (${formatCurrency(main.value, cur)})` : 'Pending';
}

function updateResultsSummary() {
  const d = state.derived;
  const c = state.config;
  const settings = state.settings;
  const cur = settings.currencyLabel;
  const elLivesTotal = document.getElementById('result-lives-total');
  const elBenefit = document.getElementById('result-benefit-monetary');
  const elCost = document.getElementById('result-cost-total');
  const elNet = document.getElementById('result-net-benefit');
  const elBcr = document.getElementById('result-bcr');
  const elSupport = document.getElementById('result-support');
  const elNarrative = document.getElementById('resultsNarrative');
  const elPolicyEval = document.getElementById('policy-eval-summary');

  if (!d || !c) {
    if (elLivesTotal) elLivesTotal.textContent = 'Pending';
    if (elBenefit) elBenefit.textContent = 'Pending';
    if (elCost) elCost.textContent = 'Pending';
    if (elNet) elNet.textContent = 'Pending';
    if (elBcr) elBcr.textContent = 'Pending';
    if (elSupport) elSupport.textContent = 'Pending';
    if (elNarrative) {
      elNarrative.textContent =
        'Apply a configuration and, if possible, enter costs to see a narrative summary of cost-benefit performance and model-based public support for the mandate.';
    }
    if (elPolicyEval) elPolicyEval.textContent = '';
    updateMRSSection(null);
    updateCharts(null, null);
    updateStatusChips(null, null);
    return;
  }

  if (elLivesTotal) elLivesTotal.textContent = `${d.livesTotal.toFixed(1)} lives`;
  if (elBenefit) elBenefit.textContent = formatCurrency(d.benefitMonetary, cur);
  if (elCost) elCost.textContent = d.costTotal > 0 ? formatCurrency(d.costTotal, cur) : 'Costs not entered';
  if (elNet) elNet.textContent = formatCurrency(d.netBenefit, cur);
  if (elBcr) elBcr.textContent = d.bcr != null ? d.bcr.toFixed(2) : 'not defined';
  if (elSupport) elSupport.textContent = formatPercent((d.support || 0) * 100);

  if (elNarrative) {
    const supp = (d.support || 0) * 100;
    const suppText = `Predicted public support for this configuration is approximately ${formatPercent(supp)}.`;
    const costText =
      d.costTotal > 0
        ? `Total implementation cost is around ${formatCurrency(
            d.costTotal,
            cur
          )}, generating an estimated benefit-cost ratio of ${d.bcr != null ? d.bcr.toFixed(2) : 'not defined'}.`
        : 'Implementation costs have not been entered, so only benefits and support can be interpreted at this stage.';
    const benefitText = `The expected lives saved parameter implies about ${d.livesTotal.toFixed(
      1
    )} lives saved in the exposed population, valued at approximately ${formatCurrency(d.benefitMonetary, cur)}.`;
    elNarrative.textContent = `${suppText} ${benefitText} ${costText}`;
  }

  if (elPolicyEval) {
    const evalText = evaluateScenarioAgainstPolicy(c, d, state.policyQuestion, state.policyConstraints);
    elPolicyEval.textContent = evalText || '';
  }

  updateMRSSection(c);
  updateCharts(d, settings);
  updateStatusChips(c, d);
}

/* Status chips for support, BCR, and data completeness */

function updateStatusChips(config, derived) {
  const chipSupport = document.getElementById('status-support');
  const chipBcr = document.getElementById('status-bcr');
  const chipData = document.getElementById('status-data');

  if (!chipSupport || !chipBcr || !chipData) return;

  if (!config || !derived) {
    chipSupport.textContent = 'Support: pending';
    chipSupport.className = 'status-chip status-neutral';
    chipBcr.textContent = 'BCR: pending';
    chipBcr.className = 'status-chip status-neutral';
    chipData.textContent = 'Data: pending';
    chipData.className = 'status-chip status-neutral';
    return;
  }

  const supp = (derived.support || 0) * 100;
  let supportClass = 'status-chip ';
  let supportText;

  if (supp < 50) {
    supportClass += 'status-negative';
    supportText = 'Support: Low';
  } else if (supp < 70) {
    supportClass += 'status-warning';
    supportText = 'Support: Medium';
  } else {
    supportClass += 'status-positive';
    supportText = 'Support: High';
  }

  chipSupport.textContent = supportText;
  chipSupport.className = supportClass;

  const bcr = derived.bcr;
  let bcrClass = 'status-chip ';
  let bcrText;

  if (bcr == null) {
    bcrClass += 'status-neutral';
    bcrText = 'BCR: Not defined';
  } else if (bcr < 0.8) {
    bcrClass += 'status-negative';
    bcrText = 'BCR: Unfavourable';
  } else if (bcr < 1.0) {
    bcrClass += 'status-warning';
    bcrText = 'BCR: Uncertain';
  } else {
    bcrClass += 'status-positive';
    bcrText = 'BCR: Favourable';
  }

  chipBcr.textContent = bcrText;
  chipBcr.className = bcrClass;

  const hasCosts = derived.costTotal && derived.costTotal > 0;
  const hasBenefitMetric = state.settings.vslValue && state.settings.vslValue > 0;

  let dataClass = 'status-chip ';
  let dataText;

  if (hasCosts && hasBenefitMetric) {
    dataClass += 'status-positive';
    dataText = 'Data: Costs & benefit metric set';
  } else if (hasBenefitMetric || hasCosts) {
    dataClass += 'status-warning';
    dataText = hasBenefitMetric
      ? 'Data: Benefit metric set, costs incomplete'
      : 'Data: Costs entered, benefit metric missing';
  } else {
    dataClass += 'status-neutral';
    dataText = 'Data: Incomplete';
  }

  chipData.textContent = dataText;
  chipData.className = dataClass;
}

/* =========================================================
   MRS section (lives-saved equivalents)
   ========================================================= */

function computeMRSRows(config) {
  if (!config) return [];

  const coefs = mxlCoefs[config.country || 'AU'][config.outbreak || 'mild'];
  const betaLives = coefs.lives || 0;
  if (!betaLives) return [];

  const rows = [];

  if (config.scope === 'all') {
    const mrsScope = -coefs.scopeAll / betaLives;
    rows.push({
      attribute: 'Scope: high-risk occupations → all occupations & public spaces',
      value: mrsScope,
      interpretation:
        mrsScope >= 0
          ? `This change is as demanding in acceptability terms as losing about ${mrsScope.toFixed(
              1
            )} expected lives saved per 100,000 people (less preferred).`
          : `This change increases acceptability, similar to gaining about ${Math.abs(
              mrsScope
            ).toFixed(1)} expected lives saved per 100,000 people (more preferred).`
    });
  }

  if (config.exemptions === 'medrel') {
    const mrsExMedRel = -coefs.exMedRel / betaLives;
    rows.push({
      attribute: 'Exemptions: medical only → medical + religious',
      value: mrsExMedRel,
      interpretation:
        mrsExMedRel >= 0
          ? `Moving to medical + religious exemptions is viewed as less desirable, comparable to losing about ${mrsExMedRel.toFixed(
              1
            )} expected lives saved per 100,000.`
          : `Moving to medical + religious exemptions is viewed as more desirable, similar to gaining about ${Math.abs(
              mrsExMedRel
            ).toFixed(1)} expected lives saved per 100,000.`
    });
  } else if (config.exemptions === 'medrelpers') {
    const mrsExMedRelPers = -coefs.exMedRelPers / betaLives;
    rows.push({
      attribute: 'Exemptions: medical only → medical + religious + personal belief',
      value: mrsExMedRelPers,
      interpretation:
        mrsExMedRelPers >= 0
          ? `Allowing medical, religious and personal belief exemptions is viewed as less preferred, similar to losing about ${mrsExMedRelPers.toFixed(
              1
            )} expected lives saved per 100,000.`
          : `Allowing medical, religious and personal belief exemptions is viewed as more preferred, similar to gaining about ${Math.abs(
              mrsExMedRelPers
            ).toFixed(1)} expected lives saved per 100,000.`
    });
  }

  if (config.coverage === 0.7) {
    const mrsCov = -coefs.cov70 / betaLives;
    rows.push({
      attribute: 'Coverage threshold: 50% → 70% vaccinated',
      value: mrsCov,
      interpretation:
        mrsCov >= 0
          ? `Raising the lifting threshold to 70% is as demanding as losing about ${mrsCov.toFixed(
              1
            )} expected lives saved per 100,000 (less preferred).`
          : `Raising the lifting threshold to 70% is viewed as beneficial, similar to gaining about ${Math.abs(
              mrsCov
            ).toFixed(1)} expected lives saved per 100,000 (more preferred).`
    });
  } else if (config.coverage === 0.9) {
    const mrsCov = -coefs.cov90 / betaLives;
    rows.push({
      attribute: 'Coverage threshold: 50% → 90% vaccinated',
      value: mrsCov,
      interpretation:
        mrsCov >= 0
          ? `Raising the lifting threshold to 90% is as demanding as losing about ${mrsCov.toFixed(
              1
            )} expected lives saved per 100,000 (less preferred).`
          : `Raising the lifting threshold to 90% is viewed as beneficial, similar to gaining about ${Math.abs(
              mrsCov
            ).toFixed(1)} expected lives saved per 100,000 (more preferred).`
    });
  }

  return rows;
}

function updateMRSSection(config) {
  const tableBody = document.querySelector('#mrs-table tbody');
  const mrsNarr = document.getElementById('mrsNarrative');
  if (!tableBody) return;

  tableBody.innerHTML = '';

  if (!config) {
    if (mrsNarr) {
      mrsNarr.textContent =
        'Configure a mandate to see how changes in scope, exemptions or coverage compare to changes in expected lives saved. Positive values indicate changes that make the option less preferred; negative values indicate changes that make it more preferred.';
    }
    return;
  }

  const rows = computeMRSRows(config);

  if (!rows.length) {
    if (mrsNarr) {
      mrsNarr.textContent =
        'Under the current configuration there is no attribute change to contrast, or the lives-saved coefficient is not available, so lives-saved equivalents (MRS) are not displayed.';
    }
    return;
  }

  rows.slice(0, 3).forEach(row => {
    const tr = document.createElement('tr');
    const tdAttr = document.createElement('td');
    const tdVal = document.createElement('td');
    const tdInterp = document.createElement('td');

    tdAttr.textContent = row.attribute;
    tdVal.textContent = row.value.toFixed(1);
    tdInterp.textContent = row.interpretation;

    tr.appendChild(tdAttr);
    tr.appendChild(tdVal);
    tr.appendChild(tdInterp);
    tableBody.appendChild(tr);
  });

  if (mrsNarr) {
    mrsNarr.textContent =
      'Lives-saved equivalents show how strongly people care about mandate design features in terms of “extra lives saved per 100,000 people”. Positive values reflect changes that make the option less preferred; negative values reflect changes that make it more preferred.';
  }
}

/* =========================================================
   Charts
   ========================================================= */

function updateCharts(derived, settings) {
  const ctxBcr = document.getElementById('chart-bcr');
  const ctxSupport = document.getElementById('chart-support');
  const ctxMRS = document.getElementById('chart-mrs');

  if (bcrChart) {
    bcrChart.destroy();
    bcrChart = null;
  }
  if (supportChart) {
    supportChart.destroy();
    supportChart = null;
  }
  if (mrsChart) {
    mrsChart.destroy();
    mrsChart = null;
  }

  if (!derived) return;
  if (typeof Chart === 'undefined') return;
  if (!ctxBcr || !ctxSupport) return;

  const cur = settings.currencyLabel;

  // Cost-benefit chart
  bcrChart = new Chart(ctxBcr, {
    type: 'bar',
    data: {
      labels: ['Benefit', 'Cost', 'Net benefit'],
      datasets: [
        {
          label: `Values (${cur})`,
          data: [derived.benefitMonetary || 0, derived.costTotal || 0, derived.netBenefit || 0]
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${formatCurrency(ctx.parsed.y, cur)}`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: value => formatShortCurrency(value, cur)
          }
        }
      }
    }
  });

  // Support vs opt-out chart
  const suppPct = (derived.support || 0) * 100;
  const optOutPct = 100 - suppPct;

  supportChart = new Chart(ctxSupport, {
    type: 'bar',
    data: {
      labels: ['Support', 'Opt-out'],
      datasets: [
        {
          label: 'Share (%)',
          data: [parseFloat(suppPct.toFixed(1)), parseFloat(optOutPct.toFixed(1))]
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: {
            callback: value => `${value}%`
          }
        }
      }
    }
  });

  // MRS chart
  if (ctxMRS && state.config) {
    const mrsRows = computeMRSRows(state.config) || [];
    if (mrsRows.length) {
      const labels = mrsRows.map(r => r.attribute);
      const data = mrsRows.map(r => parseFloat(r.value.toFixed(1)));

      mrsChart = new Chart(ctxMRS, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Lives-saved equivalent (per 100,000)',
              data
            }
          ]
        },
        options: {
          responsive: true,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.parsed.x.toFixed(1)} lives per 100,000`
              }
            }
          },
          scales: {
            x: {
              ticks: {
                callback: value => (value.toFixed ? value.toFixed(1) : value)
              }
            }
          }
        }
      });
    }
  }
}

/* =========================================================
   Scenario pinning & comparison dashboard
   ========================================================= */

function getScenarioById(id) {
  return state.scenarios.find(s => s.id === id);
}

function togglePinScenario(id) {
  const idx = state.pinnedScenarioIds.indexOf(id);
  if (idx >= 0) {
    state.pinnedScenarioIds.splice(idx, 1);
  } else {
    if (state.pinnedScenarioIds.length >= 3) {
      state.pinnedScenarioIds.shift();
    }
    state.pinnedScenarioIds.push(id);
  }
  saveToStorage();
  rebuildScenariosTable();
  updatePinnedDashboard();
}

function classifySupportLevel(suppPct) {
  if (suppPct >= 70) return 'good';
  if (suppPct >= 50) return 'medium';
  return 'poor';
}

function classifyBcrLevel(bcr) {
  if (bcr == null || !isFinite(bcr)) return 'poor';
  if (bcr >= 1.0) return 'good';
  if (bcr >= 0.8) return 'medium';
  return 'poor';
}

function formatSigned(value, decimals = 1) {
  if (!isFinite(value)) return '0';
  const v = value.toFixed(decimals);
  if (value > 0) return `+${v}`;
  if (value < 0) return v;
  return '0.0';
}

function formatSignedPercent(value) {
  if (!isFinite(value)) return '0.0%';
  const v = value.toFixed(1);
  if (value > 0) return `+${v}%`;
  if (value < 0) return `${v}%`;
  return '0.0%';
}

function updatePinnedDashboard() {
  const container = document.querySelector('.pinned-scenarios-summary');
  const canvas = document.getElementById('pinnedRadarChart') || document.getElementById('chart-scenario-radar');

  if (pinnedRadarChart) {
    pinnedRadarChart.destroy();
    pinnedRadarChart = null;
  }

  const pinned = state.pinnedScenarioIds
    .map(id => getScenarioById(id))
    .filter(s => s && s.derived && s.config);

  if (container) {
    container.innerHTML = '';

    if (!pinned.length) {
      const p = document.createElement('p');
      p.className = 'small-note';
      p.textContent =
        'Pin up to three saved scenarios in the table below to see a quick visual comparison of support, benefit-cost ratio, total lives saved and cost.';
      container.appendChild(p);
    } else {
      const ref = pinned[0];
      pinned.forEach((s, idx) => {
        const card = document.createElement('div');
        card.className = 'pinned-scenario-card';

        const header = document.createElement('div');
        header.className = 'pinned-scenario-header';

        const title = document.createElement('div');
        title.className = 'pinned-scenario-title';
        title.textContent = `Scenario ${s.id}: ${countryLabel(s.config.country)}`;

        const tag = document.createElement('div');
        tag.className = 'pinned-scenario-tag';
        tag.textContent = `${outbreakLabel(s.config.outbreak)}, ${scopeLabel(s.config.scope).toLowerCase()}`;

        header.appendChild(title);
        header.appendChild(tag);
        card.appendChild(header);

        // Traffic stripe
        const stripe = document.createElement('div');
        stripe.className = 'traffic-stripe';

        const suppPct = (s.derived.support || 0) * 100;
        const bcr = s.derived.bcr;

        const suppSeg = document.createElement('div');
        suppSeg.className = 'traffic-stripe-segment';
        const suppLevel = classifySupportLevel(suppPct);
        if (suppLevel === 'good') suppSeg.classList.add('traffic-support-good');
        else if (suppLevel === 'medium') suppSeg.classList.add('traffic-support-medium');
        else suppSeg.classList.add('traffic-support-poor');

        const bcrSeg = document.createElement('div');
        bcrSeg.className = 'traffic-stripe-segment';
        const bcrLevel = classifyBcrLevel(bcr);
        if (bcrLevel === 'good') bcrSeg.classList.add('traffic-bcr-good');
        else if (bcrLevel === 'medium') bcrSeg.classList.add('traffic-bcr-medium');
        else bcrSeg.classList.add('traffic-bcr-poor');

        stripe.appendChild(suppSeg);
        stripe.appendChild(bcrSeg);
        card.appendChild(stripe);

        // Mini summary line
        const mini = document.createElement('div');
        mini.className = 'small-note';
        mini.textContent = `Support: ${formatPercent(
          suppPct
        )}; BCR: ${bcr != null ? bcr.toFixed(2) : 'not defined'}; lives saved: ${s.derived.livesTotal.toFixed(
          1
        )}; cost: ${formatShortCurrency(s.derived.costTotal || 0, s.settings.currencyLabel)}.`;
        card.appendChild(mini);

        // Reference vs others delta
        const delta = document.createElement('div');
        delta.className = 'pinned-delta';
        if (idx === 0) {
          delta.textContent = 'Reference scenario for comparison.';
        } else {
          const dRef = ref.derived;
          const dThis = s.derived;
          const deltaSupp = ((dThis.support || 0) - (dRef.support || 0)) * 100;
          const deltaBcr = (dThis.bcr || 0) - (dRef.bcr || 0);
          delta.textContent = `Compared with Scenario ${ref.id}, this scenario changes predicted support by ${formatSignedPercent(
            deltaSupp
          )} and BCR by ${formatSigned(deltaBcr, 2)}.`;
        }
        card.appendChild(delta);

        container.appendChild(card);
      });
    }
  }

  if (!canvas || typeof Chart === 'undefined') return;
  if (!pinned.length) return;

  // Radar chart on common radial scale using normalised metrics
  const labels = ['Support (%)', 'BCR', 'Total lives saved', 'Total cost'];

  // Normalisation so that radar is readable
  const maxSupp = Math.max(...pinned.map(s => (s.derived.support || 0) * 100), 1);
  const maxBcr = Math.max(...pinned.map(s => (s.derived.bcr || 0)), 1);
  const maxLives = Math.max(...pinned.map(s => s.derived.livesTotal || 0), 1);
  const maxCost = Math.max(...pinned.map(s => s.derived.costTotal || 0), 1);

  const datasets = pinned.map((s, idx) => {
    const supp = (s.derived.support || 0) * 100;
    const bcr = s.derived.bcr || 0;
    const livesTot = s.derived.livesTotal || 0;
    const costTot = s.derived.costTotal || 0;

    const data = [
      (supp / maxSupp) * 100,
      (bcr / maxBcr) * 100,
      (livesTot / maxLives) * 100,
      (costTot / maxCost) * 100
    ];

    return {
      label: `Scenario ${s.id}`,
      data
    };
  });

  pinnedRadarChart = new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true }
      },
      scales: {
        r: {
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: {
            callback: value => `${value}%`
          }
        }
      }
    }
  });
}

/* =========================================================
   Scenarios & exports
   ========================================================= */

function saveScenario() {
  if (!state.config || !state.derived) {
    showToast('Please apply a configuration before saving a scenario.', 'warning');
    return;
  }

  const s = {
    id: state.scenarios.length + 1,
    timestamp: new Date().toISOString(),
    settings: { ...state.settings },
    config: { ...state.config },
    costs: state.costs ? { ...state.costs } : null,
    derived: { ...state.derived }
  };

  state.scenarios.push(s);
  saveToStorage();
  rebuildScenariosTable();
  populateScenarioBriefing(s);
  updateAiPrompt();
  updatePinnedDashboard();
  showToast('Scenario saved.', 'success');
}

function rebuildScenariosTable() {
  const tbody = document.querySelector('#scenarios-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!state.scenarios.length) return;

  state.scenarios.forEach((s, idx) => {
    const tr = document.createElement('tr');

    const d = s.derived;
    const c = s.config;
    const cur = s.settings.currencyLabel;

    const cells = [
      idx + 1,
      countryLabel(c.country),
      outbreakLabel(c.outbreak),
      scopeLabel(c.scope),
      exemptionsLabel(c.exemptions),
      coverageLabel(c.coverage),
      c.livesPer100k.toFixed(1),
      d ? d.livesTotal.toFixed(1) : '-',
      d ? formatShortCurrency(d.benefitMonetary, cur) : '-',
      d ? (d.costTotal > 0 ? formatShortCurrency(d.costTotal, cur) : '-') : '-',
      d ? formatShortCurrency(d.netBenefit, cur) : '-',
      d && d.bcr != null ? d.bcr.toFixed(2) : '-',
      d ? formatPercent((d.support || 0) * 100) : '-'
    ];

    cells.forEach(val => {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    });

    // Pin/Unpin button
    const tdPin = document.createElement('td');
    const btnPin = document.createElement('button');
    btnPin.type = 'button';
    btnPin.className = 'btn outline';
    const isPinned = state.pinnedScenarioIds.includes(s.id);
    btnPin.textContent = isPinned ? 'Unpin' : 'Pin';
    btnPin.addEventListener('click', e => {
      e.stopPropagation();
      togglePinScenario(s.id);
    });
    tdPin.appendChild(btnPin);
    tr.appendChild(tdPin);

    const incomplete = !d || !d.costTotal || d.costTotal === 0 || d.bcr == null;
    if (incomplete) {
      tr.classList.add('incomplete-costs');
      tr.title = 'Costs not entered or BCR not defined. Interpret with caution.';
    }

    tr.addEventListener('click', () => {
      populateScenarioBriefing(s);
    });

    tbody.appendChild(tr);
  });
}

function populateScenarioBriefing(scenario) {
  const txt = document.getElementById('scenario-briefing-text');
  if (!txt) return;
  const c = scenario.config;
  const d = scenario.derived;
  const cur = scenario.settings.currencyLabel;

  const supp = (d.support || 0) * 100;

  const text =
    `Country: ${countryLabel(c.country)}; outbreak scenario: ${outbreakLabel(c.outbreak)}.\n` +
    `Mandate scope: ${scopeLabel(c.scope)}; exemption policy: ${exemptionsLabel(
      c.exemptions
    )}; coverage threshold to lift mandate: ${coverageLabel(c.coverage)}.\n` +
    `Expected lives saved: ${c.livesPer100k.toFixed(
      1
    )} per 100,000 people, implying around ${d.livesTotal.toFixed(
      1
    )} lives saved in the exposed population.\n` +
    `Monetary benefit of lives saved (using the chosen benefit metric): ${formatCurrency(
      d.benefitMonetary,
      cur
    )}.\n` +
    `Total implementation cost (as entered): ${
      d.costTotal > 0 ? formatCurrency(d.costTotal, cur) : 'costs not entered'
    }, giving a net benefit of ${formatCurrency(
      d.netBenefit,
      cur
    )} and a benefit-cost ratio of ${d.bcr != null ? d.bcr.toFixed(2) : 'not defined'}.\n` +
    `Model-based predicted public support for this potential future mandate is approximately ${formatPercent(supp)}.\n` +
    `Interpretation: This summary can be pasted into emails or briefing documents and should be read alongside qualitative, ethical and legal considerations that are not captured in the preference study or the simple economic valuation used here.`;

  txt.value = text;
}

function updateScenarioBriefingCurrent() {
  const txt = document.getElementById('scenario-briefing-text');
  if (!txt) return;

  if (!state.config || !state.derived) {
    txt.value =
      'Once you apply a configuration (and optionally enter costs), this box will show a short, plain-language summary of the current scenario ready to copy into emails or reports.';
    return;
  }

  const c = state.config;
  const d = state.derived;
  const cur = state.settings.currencyLabel;
  const supp = (d.support || 0) * 100;

  const text =
    `Current configuration: ${countryLabel(c.country)}, ${outbreakLabel(c.outbreak)}.\n` +
    `Scope: ${scopeLabel(c.scope)}; exemptions: ${exemptionsLabel(c.exemptions)}; coverage threshold: ${coverageLabel(
      c.coverage
    )}.\n` +
    `Expected lives saved: ${c.livesPer100k.toFixed(
      1
    )} per 100,000 people (≈${d.livesTotal.toFixed(1)} lives saved in the exposed population).\n` +
    `Monetary value of lives saved (based on the selected benefit metric): ${formatCurrency(d.benefitMonetary, cur)}.\n` +
    `Implementation cost (if entered): ${
      d.costTotal > 0 ? formatCurrency(d.costTotal, cur) : 'not yet entered'
    }; net benefit: ${formatCurrency(d.netBenefit, cur)}; BCR: ${
      d.bcr != null ? d.bcr.toFixed(2) : 'not defined'
    }.\n` +
    `Predicted public support: ${formatPercent(supp)}.\n` +
    `Use this text as a starting point and add context on feasibility, distributional impacts and ethical considerations.`;

  txt.value = text;
}

/* Exports */

function exportScenarios(kind) {
  if (!state.scenarios.length) {
    showToast('No scenarios to export.', 'warning');
    return;
  }

  const header = [
    'id',
    'country',
    'outbreak',
    'scope',
    'exemptions',
    'coverage',
    'lives_per_100k',
    'lives_total',
    'benefit',
    'cost',
    'net_benefit',
    'bcr',
    'support',
    'currency',
    'timestamp'
  ];

  const rows = state.scenarios.map(s => {
    const c = s.config;
    const d = s.derived || {};
    const cur = s.settings.currencyLabel;
    return [
      s.id,
      countryLabel(c.country),
      outbreakLabel(c.outbreak),
      scopeLabel(c.scope),
      exemptionsLabel(c.exemptions),
      coverageLabel(c.coverage),
      c.livesPer100k,
      d.livesTotal || '',
      d.benefitMonetary || '',
      d.costTotal || '',
      d.netBenefit || '',
      d.bcr != null ? d.bcr : '',
      d.support || '',
      cur,
      s.timestamp
    ];
  });

  const csvLines = [
    header.join(','),
    ...rows.map(r => r.map(v => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v)).join(','))
  ];
  const csvContent = csvLines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  if (kind === 'csv' || kind === 'excel') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'excel' ? 'emandeval_future_scenarios.xlsx.csv' : 'emandeval_future_scenarios.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast(
      kind === 'excel'
        ? 'Scenarios exported as CSV (Excel-readable).'
        : 'Scenarios exported as CSV.',
      'success'
    );
    return;
  }

  if (kind === 'pdf') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emandeval_future_scenarios_summary.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Summary data exported as CSV for use in PDF/reporting tools.', 'success');
    return;
  }

  if (kind === 'word') {
    exportScenariosAsWord();
    return;
  }
}

function exportScenariosAsWord() {
  const title = 'eMANDEVAL Future: Vaccine Mandate Scenario Briefings';
  const now = new Date().toLocaleString();

  let html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f2933; }
  h1 { font-size: 16pt; margin-bottom: 4pt; }
  h2 { font-size: 13pt; margin-top: 12pt; margin-bottom: 4pt; }
  h3 { font-size: 11pt; margin-top: 8pt; margin-bottom: 3pt; }
  p { margin: 2pt 0; }
  ul { margin: 0 0 4pt 18pt; padding: 0; }
  li { margin: 0 0 2pt 0; }
  .meta { font-size: 9pt; color: #6b7280; margin-bottom: 8pt; }
  .section { margin-bottom: 10pt; }
  .label { font-weight: bold; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">Generated on ${escapeHtml(
    now
  )}. Each scenario is based on mixed logit preference estimates and user-entered settings in the eMANDEVAL-Future tool.</p>
`;

  state.scenarios.forEach(s => {
    const c = s.config;
    const d = s.derived || {};
    const set = s.settings || state.settings;
    const cur = set.currencyLabel;
    const supp = (d.support || 0) * 100;

    html += `<div class="section">`;
    html += `<h2>Scenario ${s.id}: ${escapeHtml(countryLabel(c.country))}, ${escapeHtml(
      outbreakLabel(c.outbreak)
    )}</h2>`;
    html += `<p><span class="label">Time stamp:</span> ${escapeHtml(s.timestamp)}</p>`;

    html += `<h3>Mandate configuration</h3><ul>`;
    html += `<li><span class="label">Scope:</span> ${escapeHtml(scopeLabel(c.scope))}</li>`;
    html += `<li><span class="label">Exemptions:</span> ${escapeHtml(exemptionsLabel(c.exemptions))}</li>`;
    html += `<li><span class="label">Coverage requirement to lift mandate:</span> ${escapeHtml(
      coverageLabel(c.coverage)
    )}</li>`;
    html += `<li><span class="label">Expected lives saved:</span> ${c.livesPer100k.toFixed(
      1
    )} per 100,000 people</li>`;
    html += `<li><span class="label">Population covered:</span> ${set.population.toLocaleString()} people</li>`;
    html += `</ul>`;

    html += `<h3>Epidemiological benefit and monetary valuation</h3><ul>`;
    html += `<li><span class="label">Total lives saved (approx.):</span> ${
      d.livesTotal ? d.livesTotal.toFixed(1) : '-'
    } lives</li>`;
    html += `<li><span class="label">Benefit metric (per life saved or equivalent):</span> ${formatCurrency(
      set.vslValue,
      cur
    )}</li>`;
    html += `<li><span class="label">Monetary benefit of lives saved:</span> ${formatCurrency(
      d.benefitMonetary || 0,
      cur
    )}</li>`;
    html += `</ul>`;

    html += `<h3>Costs and benefit-cost profile</h3><ul>`;
    html += `<li><span class="label">Total implementation cost (as entered):</span> ${formatCurrency(
      d.costTotal || 0,
      cur
    )}</li>`;
    html += `<li><span class="label">Net benefit (benefit − cost):</span> ${formatCurrency(
      d.netBenefit || 0,
      cur
    )}</li>`;
    html += `<li><span class="label">Benefit-cost ratio (BCR):</span> ${
      d.bcr != null ? d.bcr.toFixed(2) : 'not defined'
    }</li>`;
    html += `</ul>`;

    html += `<h3>Model-based public support</h3><ul>`;
    html += `<li><span class="label">Predicted public support:</span> ${formatPercent(supp)}</li>`;
    html += `</ul>`;

    html += `<h3>Interpretation (for policy discussion)</h3>`;
    html += `<p>This scenario combines the model-based estimate of public support with a simple valuation of lives saved and indicative implementation costs. `;
    html += `Predicted support of ${formatPercent(
      supp
    )} should be interpreted as an indicative acceptance level under the stated outbreak scenario and mandate design, not as a forecast. `;
    html += `Net benefit and the benefit-cost ratio summarise the trade off between epidemiological benefit and implementation cost, but do not capture important `;
    html += `ethical, legal, distributional or political considerations. These figures should therefore be read alongside qualitative judgements and stakeholder input.</p>`;
    html += `</div>`;
  });

  html += `<p class="meta">Note: All figures depend on the assumptions entered into eMANDEVAL-Future (population, benefit metric per life saved, cost inputs). For formal regulatory appraisal, the underlying data and assumptions should be checked and documented in a technical annex.</p>`;
  html += `</body></html>`;

  const blobDoc = new Blob([html], {
    type: 'application/msword;charset=utf-8;'
  });
  const url = URL.createObjectURL(blobDoc);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'emandeval_future_scenarios_briefing.doc';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Word briefing downloaded (ready to print or edit).', 'success');
}

/* =========================================================
   Briefing & AI prompt
   ========================================================= */

function updateBriefingTemplate() {
  const el = document.getElementById('briefing-template');
  if (!el) return;

  if (!state.config || !state.derived) {
    el.value =
      'Apply a configuration and enter costs to auto-populate a briefing template based on the current scenario.';
    return;
  }

  const c = state.config;
  const d = state.derived;
  const s = state.settings;
  const supp = (d.support || 0) * 100;
  const cur = s.currencyLabel;
  const metricLabel = benefitMetricMeta[s.vslMetric]
    ? benefitMetricMeta[s.vslMetric].label
    : 'Selected benefit metric';

  const text =
    `Purpose\n` +
    `Summarise the expected public support, epidemiological benefits and indicative economic value of a specific potential future vaccine mandate configuration in ${countryLabel(
      c.country
    )} under a ${outbreakLabel(c.outbreak).toLowerCase()} scenario.\n\n` +
    `Mandate configuration\n` +
    `• Country: ${countryLabel(c.country)}\n` +
    `• Outbreak scenario: ${outbreakLabel(c.outbreak)}\n` +
    `• Mandate scope: ${scopeLabel(c.scope)}\n` +
    `• Exemption policy: ${exemptionsLabel(c.exemptions)}\n` +
    `• Coverage requirement to lift mandate: ${coverageLabel(c.coverage)}\n` +
    `• Expected lives saved: ${c.livesPer100k.toFixed(1)} per 100,000 people\n\n` +
    `Epidemiological benefit and monetary valuation\n` +
    `• Exposed population: ${s.population.toLocaleString()} people\n` +
    `• Total lives saved (model input × population): ${d.livesTotal.toFixed(1)}\n` +
    `• Benefit metric: ${metricLabel}\n` +
    `• Value per life saved / equivalent health gain: ${formatCurrency(s.vslValue, cur)}\n` +
    `• Monetary value of lives saved: ${formatCurrency(d.benefitMonetary, cur)}\n\n` +
    `Costs and benefit-cost profile\n` +
    `• Total implementation cost (as entered): ${formatCurrency(d.costTotal, cur)}\n` +
    `• Net benefit (benefit − cost): ${formatCurrency(d.netBenefit, cur)}\n` +
    `• Benefit-cost ratio (BCR): ${d.bcr != null ? d.bcr.toFixed(2) : 'not defined'}\n\n` +
    `Model-based public support\n` +
    `• Predicted public support for this mandate configuration: ${formatPercent(
      supp
    )}\n\n` +
    `Interpretation (to be tailored)\n` +
    `This configuration appears to offer ${
      d.bcr != null && d.bcr >= 1 ? 'a favourable' : 'an uncertain'
    } balance between epidemiological benefit and implementation cost, with predicted public support at around ${formatPercent(
      supp
    )}. These results should be interpreted alongside distributional, ethical and legal considerations that are not captured in the preference study or the simple economic valuation used here.`;

  el.value = text;
}

function updateAiPrompt() {
  const el = document.getElementById('ai-prompt');
  if (!el) return;

  const scenarios = state.scenarios || [];

  // Case 1: at least one saved scenario - use them for comparison
  if (scenarios.length > 0) {
    const multi = scenarios.length > 1;
    let prompt =
      `You are helping a public health policy team evaluate potential future vaccine mandates.\n\n` +
      `We have ${scenarios.length} saved mandate scenario${multi ? 's' : ''} generated from the eMANDEVAL-Future tool. Each scenario includes a mandate design, expected epidemiological benefit, monetary valuation and indicative implementation costs.\n\n`;

    scenarios.forEach(s => {
      const c = s.config;
      const d = s.derived || {};
      const set = s.settings || state.settings;
      const cur = set.currencyLabel;
      const supp = (d.support || 0) * 100;
      const metricLabel = benefitMetricMeta[set.vslMetric]
        ? benefitMetricMeta[set.vslMetric].label
        : 'Selected benefit metric';

      prompt += `SCENARIO ${s.id}\n`;
      prompt += `- Country: ${countryLabel(c.country)}\n`;
      prompt += `- Outbreak scenario: ${outbreakLabel(c.outbreak)}\n`;
      prompt += `- Mandate scope: ${scopeLabel(c.scope)}\n`;
      prompt += `- Exemption policy: ${exemptionsLabel(c.exemptions)}\n`;
      prompt += `- Coverage threshold to lift mandate: ${coverageLabel(c.coverage)}\n`;
      prompt += `- Expected lives saved: ${c.livesPer100k.toFixed(1)} per 100,000 people\n`;
      prompt += `- Population covered: ${set.population.toLocaleString()} people\n`;
      prompt += `- Benefit metric: ${metricLabel}\n`;
      prompt += `- Value per life saved / equivalent health gain: ${formatCurrency(set.vslValue, cur)}\n`;
      prompt += `- Estimated total lives saved: ${d.livesTotal ? d.livesTotal.toFixed(1) : '-'}\n`;
      prompt += `- Monetary benefit of lives saved: ${formatCurrency(d.benefitMonetary || 0, cur)}\n`;
      prompt += `- Total implementation cost: ${formatCurrency(d.costTotal || 0, cur)}\n`;
      prompt += `- Net benefit: ${formatCurrency(d.netBenefit || 0, cur)}\n`;
      prompt += `- Benefit-cost ratio (BCR): ${d.bcr != null ? d.bcr.toFixed(2) : 'not defined'}\n`;
      prompt += `- Model-based predicted public support: ${formatPercent(supp)}\n\n`;
    });

    prompt += `TASK FOR YOU:\n`;
    if (multi) {
      prompt +=
        `1. Provide a concise comparative summary of the scenarios, highlighting key differences in mandate design, predicted support, epidemiological benefit and benefit-cost performance.\n` +
        `2. Identify which scenario or small set of scenarios appear most attractive under different decision criteria, for example: (a) maximising predicted support subject to a minimum BCR; (b) maximising BCR subject to a minimum support level.\n` +
        `3. Flag key uncertainties or assumptions that decision-makers should be aware of (for example the choice of benefit metric, the quality of cost estimates, distributional impacts).\n` +
        `4. Suggest up to three concise points for ministers or senior officials to consider when comparing these options, including any obvious “dominated” scenarios that should probably be ruled out.\n`;
    } else {
      prompt +=
        `1. Provide a short, neutral and clear policy briefing that summarises this scenario in plain language.\n` +
        `2. Highlight the trade offs between public health impact, costs and public support.\n` +
        `3. Flag key uncertainties or assumptions.\n` +
        `4. Suggest up to three points for ministers or senior officials to consider when comparing this option with potential alternatives.\n`;
    }

    prompt += `\nUse British spelling and keep the tone suitable for a government briefing. Do not assume that the scenarios fully capture legal, ethical or equity considerations; instead, explicitly note that these require separate assessment.`;

    el.value = prompt;
    return;
  }

  // Case 2: no saved scenarios but a current configuration exists - fall back to current config
  if (!state.config || !state.derived) {
    el.value =
      'Apply a configuration and enter costs (and/or save scenarios) to auto-generate an AI prompt for Copilot or ChatGPT based on the current scenario.';
    return;
  }

  const c = state.config;
  const d = state.derived;
  const s = state.settings;
  const supp = (d.support || 0) * 100;
  const cur = s.currencyLabel;
  const metricLabelSingle = benefitMetricMeta[s.vslMetric]
    ? benefitMetricMeta[s.vslMetric].label
    : 'Selected benefit metric';

  const promptSingle =
    `You are helping a public health policy team design a potential future vaccine mandate.\n\n` +
    `CURRENT MANDATE CONFIGURATION\n` +
    `- Country: ${countryLabel(c.country)}\n` +
    `- Outbreak scenario: ${outbreakLabel(c.outbreak)}\n` +
    `- Scope: ${scopeLabel(c.scope)}\n` +
    `- Exemption policy: ${exemptionsLabel(c.exemptions)}\n` +
    `- Coverage threshold to lift mandate: ${coverageLabel(c.coverage)}\n` +
    `- Expected lives saved: ${c.livesPer100k.toFixed(1)} per 100,000 people\n\n` +
    `SETTINGS\n` +
    `- Analysis horizon: ${s.horizonYears} year(s)\n` +
    `- Population covered: ${s.population.toLocaleString()} people\n` +
    `- Currency label: ${cur}\n` +
    `- Benefit metric: ${metricLabelSingle}\n` +
    `- Value per life saved / equivalent health gain: ${formatCurrency(s.vslValue, cur)}\n\n` +
    `COST-BENEFIT SUMMARY FOR CURRENT CONFIGURATION\n` +
    `- Total implementation cost: ${formatCurrency(d.costTotal, cur)}\n` +
    `- Estimated total lives saved: ${d.livesTotal.toFixed(1)}\n` +
    `- Monetary benefit of lives saved: ${formatCurrency(d.benefitMonetary, cur)}\n` +
    `- Net benefit: ${formatCurrency(d.netBenefit, cur)}\n` +
    `- Benefit-cost ratio (BCR): ${d.bcr != null ? d.bcr.toFixed(2) : 'not defined'}\n` +
    `- Predicted public support (from mixed logit model): ${formatPercent(supp)}\n\n` +
    `TASK FOR YOU:\n` +
    `Draft a short, neutral and clear policy briefing that:\n` +
    `1. Summarises this mandate option in plain language.\n` +
    `2. Highlights the trade offs between public health impact, costs and public support.\n` +
    `3. Flags key uncertainties or assumptions.\n` +
    `4. Suggests up to three points for ministers or senior officials to consider when comparing this option with alternatives.\n\n` +
    `Use British spelling and keep the tone suitable for a government briefing.`;

  el.value = promptSingle;
}

/* =========================================================
   Guided policy question mode
   ========================================================= */

function updatePolicyGuidance() {
  const elText = document.getElementById('policy-guidance-text');
  if (!elText) return;

  const q = state.policyQuestion;
  if (q === 'strict_vs_lenient') {
    elText.textContent =
      'Use this mode to frame a side-by-side comparison of a relatively strict versus a relatively lenient mandate. Save each configuration as a scenario and pin both in the dashboard to see visual differences in support, BCR, total lives saved and cost.';
  } else if (q === 'max_support_bcr') {
    elText.textContent =
      'Use this mode when the priority is to maximise predicted support subject to a minimum acceptable benefit-cost ratio. Set your minimum BCR and then look for scenarios that clear this bar while delivering the highest support.';
  } else if (q === 'max_bcr_support') {
    elText.textContent =
      'Use this mode when the priority is to maximise the benefit-cost ratio subject to a minimum support threshold. Set your minimum support level and look for scenarios with the highest BCR above that line.';
  } else if (q === 'compare_countries') {
    elText.textContent =
      'Use this mode to compare mandate designs across countries. Save at least one scenario per country, pin up to three, and use the radar chart plus the briefing prompts to show headline differences.';
  } else {
    elText.textContent =
      'Start by choosing what you are mainly trying to do (for example, compare strict versus lenient mandates, or find options that balance support and benefit-cost performance). The guidance here will adapt to that choice.';
  }
}

function evaluateScenarioAgainstPolicy(config, derived, policyQuestion, constraints) {
  if (!config || !derived) return '';

  const supp = (derived.support || 0) * 100;
  const bcr = derived.bcr;

  if (policyQuestion === 'max_support_bcr') {
    const minBcr = constraints.minBcr;
    if (minBcr == null || !isFinite(minBcr)) {
      return 'Policy question: maximise support subject to a minimum BCR. Set a minimum BCR to see whether this option clears the bar.';
    }
    if (bcr == null || !isFinite(bcr)) {
      return `Policy question: maximise support subject to BCR ≥ ${minBcr}. The BCR for this scenario is not yet defined because costs are missing.`;
    }
    if (bcr >= minBcr) {
      return `Policy lens: this configuration clears the minimum BCR threshold (BCR ≈ ${bcr.toFixed(
        2
      )} ≥ ${minBcr}). Among all options that meet this bar, decision-makers may wish to prioritise the scenarios with the highest predicted support.`;
    }
    return `Policy lens: this configuration does not meet the minimum BCR threshold (BCR ≈ ${bcr.toFixed(
      2
    )} < ${minBcr}). It is unlikely to be favoured if the primary objective is to maximise support while maintaining BCR ≥ ${minBcr}.`;
  }

  if (policyQuestion === 'max_bcr_support') {
    const minSupp = constraints.minSupport;
    if (minSupp == null || !isFinite(minSupp)) {
      return 'Policy question: maximise BCR subject to a minimum support level. Set a minimum support percentage to see whether this option clears the bar.';
    }
    if (supp >= minSupp) {
      if (bcr == null || !isFinite(bcr)) {
        return `Policy lens: this configuration clears the minimum support threshold (support ≈ ${formatPercent(
          supp
        )} ≥ ${formatPercent(minSupp)}). Its benefit-cost ratio is not yet defined because costs are missing.`;
      }
      return `Policy lens: this configuration clears the minimum support threshold (support ≈ ${formatPercent(
        supp
      )} ≥ ${formatPercent(
        minSupp
      )}). Among all such options, this scenario should be compared on BCR; higher BCR values are more attractive from a benefit-cost perspective.`;
    }
    return `Policy lens: this configuration falls short of the minimum support threshold (support ≈ ${formatPercent(
      supp
    )} < ${formatPercent(
      minSupp
    )}). It may be difficult to defend if the policy priority is maintaining at least this level of public support.`;
  }

  if (policyQuestion === 'strict_vs_lenient') {
    return 'Policy lens: use this configuration as either the “strict” or the “lenient” benchmark in a pair. Save and pin it, then configure and save a contrasting scenario so that the dashboard and briefings can highlight differences for decision-makers.';
  }

  if (policyQuestion === 'compare_countries') {
    return `Policy lens: this configuration contributes to a cross-country comparison. Consider saving at least one broadly comparable scenario for each country of interest, then use the pinned dashboard and auto-generated briefings to highlight contextual differences (such as support levels, BCR and implied lives saved) across settings.`;
  }

  return '';
}

/* =========================================================
   Toasts
   ========================================================= */

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  if (type === 'success') toast.classList.add('toast-success');
  else if (type === 'warning') toast.classList.add('toast-warning');
  else if (type === 'error') toast.classList.add('toast-error');

  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 4500);
}

/* =========================================================
   Formatting helpers
   ========================================================= */

function formatCurrency(value, currencyLabel) {
  const v = typeof value === 'number' ? value : 0;
  if (!isFinite(v)) return `${currencyLabel} ?`;
  const abs = Math.abs(v);
  let formatted;
  if (abs >= 1e9) {
    formatted = (v / 1e9).toFixed(2) + ' B';
  } else if (abs >= 1e6) {
    formatted = (v / 1e6).toFixed(2) + ' M';
  } else if (abs >= 1e3) {
    formatted = (v / 1e3).toFixed(1) + ' K';
  } else {
    formatted = v.toFixed(0);
  }
  return `${currencyLabel} ${formatted}`;
}

function formatShortCurrency(value, currencyLabel) {
  const v = typeof value === 'number' ? value : 0;
  const abs = Math.abs(v);
  if (!isFinite(v)) return '?';
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function formatPercent(value) {
  if (value == null || !isFinite(value)) return 'Pending';
  return `${value.toFixed(1)}%`;
}

function countryLabel(code) {
  if (code === 'AU') return 'Australia';
  if (code === 'FR') return 'France';
  if (code === 'IT') return 'Italy';
  return code || 'Not set';
}

function outbreakLabel(code) {
  if (code === 'mild') return 'Mild / endemic';
  if (code === 'severe') return 'Severe outbreak';
  return code || 'Not set';
}

function scopeLabel(code) {
  if (code === 'highrisk') return 'High-risk occupations only';
  if (code === 'all') return 'All occupations & public spaces';
  return code || 'Not set';
}

function exemptionsLabel(code) {
  if (code === 'medical') return 'Medical only';
  if (code === 'medrel') return 'Medical + religious';
  if (code === 'medrelpers') return 'Medical + religious + personal belief';
  return code || 'Not set';
}

function coverageLabel(val) {
  if (val === 0.5 || String(val) === '0.5') return '50% population vaccinated';
  if (val === 0.7 || String(val) === '0.7') return '70% population vaccinated';
  if (val === 0.9 || String(val) === '0.9') return '90% population vaccinated';
  return String(val);
}

function copyFromTextarea(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.value || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast('Text copied to clipboard.', 'success'),
      () => fallbackCopy(el)
    );
  } else {
    fallbackCopy(el);
  }
}

function fallbackCopy(el) {
  el.select();
  el.setSelectionRange(0, 99999);
  document.execCommand('copy');
  showToast('Text copied to clipboard.', 'success');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
