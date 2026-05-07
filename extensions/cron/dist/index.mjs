// extensions/cron/node_modules/irises-extension-sdk/src/scheduler.ts
var SCHEDULER_SERVICE_ID = "scheduler.tasks";
// extensions/cron/node_modules/irises-extension-sdk/src/logger.ts
var _logLevel = 1 /* INFO */;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= 0 /* DEBUG */)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= 1 /* INFO */)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= 2 /* WARN */)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= 3 /* ERROR */)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// extensions/cron/node_modules/irises-extension-sdk/src/plugin/context.ts
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// extensions/cron/node_modules/irises-extension-sdk/src/runtime-paths.ts
import os from "node:os";
import path from "node:path";
function resolveDefaultDataDir(customDataDir) {
  return path.resolve(customDataDir || process.env.IRIS_DATA_DIR || path.join(os.homedir(), ".iris"));
}
// extensions/cron/src/scheduler.ts
import * as fs from "fs";
import * as path2 from "path";

// extensions/cron/node_modules/croner/dist/croner.js
function T(s) {
  return Date.UTC(s.y, s.m - 1, s.d, s.h, s.i, s.s);
}
function D(s, e) {
  return s.y === e.y && s.m === e.m && s.d === e.d && s.h === e.h && s.i === e.i && s.s === e.s;
}
function A(s, e) {
  let t = new Date(Date.parse(s));
  if (isNaN(t))
    throw new Error("Invalid ISO8601 passed to timezone parser.");
  let r = s.substring(9);
  return r.includes("Z") || r.includes("+") || r.includes("-") ? b(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), "Etc/UTC") : b(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), e);
}
function v(s, e, t) {
  return k(A(s, e), t);
}
function k(s, e) {
  let t = new Date(T(s)), r = g(t, s.tz), n = T(s), i = T(r), a = n - i, o = new Date(t.getTime() + a), h = g(o, s.tz);
  if (D(h, s)) {
    let u = new Date(o.getTime() - 3600000), d = g(u, s.tz);
    return D(d, s) ? u : o;
  }
  let l = new Date(o.getTime() + T(s) - T(h)), y = g(l, s.tz);
  if (D(y, s))
    return l;
  if (e)
    throw new Error("Invalid date passed to fromTZ()");
  return o.getTime() > l.getTime() ? o : l;
}
function g(s, e) {
  let t, r;
  try {
    t = new Intl.DateTimeFormat("en-US", { timeZone: e, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hour12: false }), r = t.formatToParts(s);
  } catch (i) {
    let a = i instanceof Error ? i.message : String(i);
    throw new RangeError(`toTZ: Invalid timezone '${e}' or date. Please provide a valid IANA timezone (e.g., 'America/New_York', 'Europe/Stockholm'). Original error: ${a}`);
  }
  let n = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (let i of r)
    (i.type === "year" || i.type === "month" || i.type === "day" || i.type === "hour" || i.type === "minute" || i.type === "second") && (n[i.type] = parseInt(i.value, 10));
  if (isNaN(n.year) || isNaN(n.month) || isNaN(n.day) || isNaN(n.hour) || isNaN(n.minute) || isNaN(n.second))
    throw new Error(`toTZ: Failed to parse all date components from timezone '${e}'. This may indicate an invalid date or timezone configuration. Parsed components: ${JSON.stringify(n)}`);
  return n.hour === 24 && (n.hour = 0), { y: n.year, m: n.month, d: n.day, h: n.hour, i: n.minute, s: n.second, tz: e };
}
function b(s, e, t, r, n, i, a) {
  return { y: s, m: e, d: t, h: r, i: n, s: i, tz: a };
}
var O = [1, 2, 4, 8, 16];
var C = class {
  pattern;
  timezone;
  mode;
  alternativeWeekdays;
  sloppyRanges;
  second;
  minute;
  hour;
  day;
  month;
  dayOfWeek;
  year;
  lastDayOfMonth;
  lastWeekday;
  nearestWeekdays;
  starDOM;
  starDOW;
  starYear;
  useAndLogic;
  constructor(e, t, r) {
    this.pattern = e, this.timezone = t, this.mode = r?.mode ?? "auto", this.alternativeWeekdays = r?.alternativeWeekdays ?? false, this.sloppyRanges = r?.sloppyRanges ?? false, this.second = Array(60).fill(0), this.minute = Array(60).fill(0), this.hour = Array(24).fill(0), this.day = Array(31).fill(0), this.month = Array(12).fill(0), this.dayOfWeek = Array(7).fill(0), this.year = Array(1e4).fill(0), this.lastDayOfMonth = false, this.lastWeekday = false, this.nearestWeekdays = Array(31).fill(0), this.starDOM = false, this.starDOW = false, this.starYear = false, this.useAndLogic = false, this.parse();
  }
  parse() {
    if (!(typeof this.pattern == "string" || this.pattern instanceof String))
      throw new TypeError("CronPattern: Pattern has to be of type string.");
    this.pattern.indexOf("@") >= 0 && (this.pattern = this.handleNicknames(this.pattern).trim());
    let e = this.pattern.match(/\S+/g) || [""], t = e.length;
    if (e.length < 5 || e.length > 7)
      throw new TypeError("CronPattern: invalid configuration format ('" + this.pattern + "'), exactly five, six, or seven space separated parts are required.");
    if (this.mode !== "auto") {
      let n;
      switch (this.mode) {
        case "5-part":
          n = 5;
          break;
        case "6-part":
          n = 6;
          break;
        case "7-part":
          n = 7;
          break;
        case "5-or-6-parts":
          n = [5, 6];
          break;
        case "6-or-7-parts":
          n = [6, 7];
          break;
        default:
          n = 0;
      }
      if (!(Array.isArray(n) ? n.includes(t) : t === n)) {
        let a = Array.isArray(n) ? n.join(" or ") : n.toString();
        throw new TypeError(`CronPattern: mode '${this.mode}' requires exactly ${a} parts, but pattern '${this.pattern}' has ${t} parts.`);
      }
    }
    if (e.length === 5 && e.unshift("0"), e.length === 6 && e.push("*"), e[3].toUpperCase() === "LW" ? (this.lastWeekday = true, e[3] = "") : e[3].toUpperCase().indexOf("L") >= 0 && (e[3] = e[3].replace(/L/gi, ""), this.lastDayOfMonth = true), e[3] == "*" && (this.starDOM = true), e[6] == "*" && (this.starYear = true), e[4].length >= 3 && (e[4] = this.replaceAlphaMonths(e[4])), e[5].length >= 3 && (e[5] = this.alternativeWeekdays ? this.replaceAlphaDaysQuartz(e[5]) : this.replaceAlphaDays(e[5])), e[5].startsWith("+") && (this.useAndLogic = true, e[5] = e[5].substring(1), e[5] === ""))
      throw new TypeError("CronPattern: Day-of-week field cannot be empty after '+' modifier.");
    switch (e[5] == "*" && (this.starDOW = true), this.pattern.indexOf("?") >= 0 && (e[0] = e[0].replace(/\?/g, "*"), e[1] = e[1].replace(/\?/g, "*"), e[2] = e[2].replace(/\?/g, "*"), e[3] = e[3].replace(/\?/g, "*"), e[4] = e[4].replace(/\?/g, "*"), e[5] = e[5].replace(/\?/g, "*"), e[6] && (e[6] = e[6].replace(/\?/g, "*"))), this.mode) {
      case "5-part":
        e[0] = "0", e[6] = "*";
        break;
      case "6-part":
        e[6] = "*";
        break;
      case "5-or-6-parts":
        e[6] = "*";
        break;
      case "6-or-7-parts":
        break;
      case "7-part":
      case "auto":
        break;
    }
    this.throwAtIllegalCharacters(e), this.partToArray("second", e[0], 0, 1), this.partToArray("minute", e[1], 0, 1), this.partToArray("hour", e[2], 0, 1), this.partToArray("day", e[3], -1, 1), this.partToArray("month", e[4], -1, 1);
    let r = this.alternativeWeekdays ? -1 : 0;
    this.partToArray("dayOfWeek", e[5], r, 63), this.partToArray("year", e[6], 0, 1), !this.alternativeWeekdays && this.dayOfWeek[7] && (this.dayOfWeek[0] = this.dayOfWeek[7]);
  }
  partToArray(e, t, r, n) {
    let i = this[e], a = e === "day" && this.lastDayOfMonth, o = e === "day" && this.lastWeekday;
    if (t === "" && !a && !o)
      throw new TypeError("CronPattern: configuration entry " + e + " (" + t + ") is empty, check for trailing spaces.");
    if (t === "*")
      return i.fill(n);
    let h = t.split(",");
    if (h.length > 1)
      for (let l = 0;l < h.length; l++)
        this.partToArray(e, h[l], r, n);
    else
      t.indexOf("-") !== -1 && t.indexOf("/") !== -1 ? this.handleRangeWithStepping(t, e, r, n) : t.indexOf("-") !== -1 ? this.handleRange(t, e, r, n) : t.indexOf("/") !== -1 ? this.handleStepping(t, e, r, n) : t !== "" && this.handleNumber(t, e, r, n);
  }
  throwAtIllegalCharacters(e) {
    for (let t = 0;t < e.length; t++)
      if ((t === 3 ? /[^/*0-9,\-WwLl]+/ : t === 5 ? /[^/*0-9,\-#Ll]+/ : /[^/*0-9,\-]+/).test(e[t]))
        throw new TypeError("CronPattern: configuration entry " + t + " (" + e[t] + ") contains illegal characters.");
  }
  handleNumber(e, t, r, n) {
    let i = this.extractNth(e, t), a = e.toUpperCase().includes("W");
    if (t !== "day" && a)
      throw new TypeError("CronPattern: Nearest weekday modifier (W) only allowed in day-of-month.");
    a && (t = "nearestWeekdays");
    let o = parseInt(i[0], 10) + r;
    if (isNaN(o))
      throw new TypeError("CronPattern: " + t + " is not a number: '" + e + "'");
    this.setPart(t, o, i[1] || n);
  }
  setPart(e, t, r) {
    if (!Object.prototype.hasOwnProperty.call(this, e))
      throw new TypeError("CronPattern: Invalid part specified: " + e);
    if (e === "dayOfWeek") {
      if (t === 7 && (t = 0), t < 0 || t > 6)
        throw new RangeError("CronPattern: Invalid value for dayOfWeek: " + t);
      this.setNthWeekdayOfMonth(t, r);
      return;
    }
    if (e === "second" || e === "minute") {
      if (t < 0 || t >= 60)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "hour") {
      if (t < 0 || t >= 24)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "day" || e === "nearestWeekdays") {
      if (t < 0 || t >= 31)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "month") {
      if (t < 0 || t >= 12)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "year" && (t < 1 || t >= 1e4))
      throw new RangeError("CronPattern: Invalid value for " + e + ": " + t + " (supported range: 1-9999)");
    this[e][t] = r;
  }
  validateNotNaN(e, t) {
    if (isNaN(e))
      throw new TypeError(t);
  }
  validateRange(e, t, r, n, i) {
    if (e > t)
      throw new TypeError("CronPattern: From value is larger than to value: '" + i + "'");
    if (r !== undefined) {
      if (r === 0)
        throw new TypeError("CronPattern: Syntax error, illegal stepping: 0");
      if (r > this[n].length)
        throw new TypeError("CronPattern: Syntax error, steps cannot be greater than maximum value of part (" + this[n].length + ")");
    }
  }
  handleRangeWithStepping(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in ranges with stepping.");
    let i = this.extractNth(e, t), a = i[0].match(/^(\d+)-(\d+)\/(\d+)$/);
    if (a === null)
      throw new TypeError("CronPattern: Syntax error, illegal range with stepping: '" + e + "'");
    let [, o, h, l] = a, y = parseInt(o, 10) + r, u = parseInt(h, 10) + r, d = parseInt(l, 10);
    this.validateNotNaN(y, "CronPattern: Syntax error, illegal lower range (NaN)"), this.validateNotNaN(u, "CronPattern: Syntax error, illegal upper range (NaN)"), this.validateNotNaN(d, "CronPattern: Syntax error, illegal stepping: (NaN)"), this.validateRange(y, u, d, t, e);
    for (let c = y;c <= u; c += d)
      this.setPart(t, c, i[1] || n);
  }
  extractNth(e, t) {
    let r = e, n;
    if (r.includes("#")) {
      if (t !== "dayOfWeek")
        throw new Error("CronPattern: nth (#) only allowed in day-of-week field");
      n = r.split("#")[1], r = r.split("#")[0];
    } else if (r.toUpperCase().endsWith("L")) {
      if (t !== "dayOfWeek")
        throw new Error("CronPattern: L modifier only allowed in day-of-week field (use L alone for day-of-month)");
      n = "L", r = r.slice(0, -1);
    }
    return [r, n];
  }
  handleRange(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in a range.");
    let i = this.extractNth(e, t), a = i[0].split("-");
    if (a.length !== 2)
      throw new TypeError("CronPattern: Syntax error, illegal range: '" + e + "'");
    let o = parseInt(a[0], 10) + r, h = parseInt(a[1], 10) + r;
    this.validateNotNaN(o, "CronPattern: Syntax error, illegal lower range (NaN)"), this.validateNotNaN(h, "CronPattern: Syntax error, illegal upper range (NaN)"), this.validateRange(o, h, undefined, t, e);
    for (let l = o;l <= h; l++)
      this.setPart(t, l, i[1] || n);
  }
  handleStepping(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in parts with stepping.");
    let i = this.extractNth(e, t), a = i[0].split("/");
    if (a.length !== 2)
      throw new TypeError("CronPattern: Syntax error, illegal stepping: '" + e + "'");
    if (this.sloppyRanges)
      a[0] === "" && (a[0] = "*");
    else {
      if (a[0] === "")
        throw new TypeError("CronPattern: Syntax error, stepping with missing prefix ('" + e + "') is not allowed. Use wildcard (*/step) or range (min-max/step) instead.");
      if (a[0] !== "*")
        throw new TypeError("CronPattern: Syntax error, stepping with numeric prefix ('" + e + "') is not allowed. Use wildcard (*/step) or range (min-max/step) instead.");
    }
    let o = 0;
    a[0] !== "*" && (o = parseInt(a[0], 10) + r);
    let h = parseInt(a[1], 10);
    this.validateNotNaN(h, "CronPattern: Syntax error, illegal stepping: (NaN)"), this.validateRange(0, this[t].length - 1, h, t, e);
    for (let l = o;l < this[t].length; l += h)
      this.setPart(t, l, i[1] || n);
  }
  replaceAlphaDays(e) {
    return e.replace(/-sun/gi, "-7").replace(/sun/gi, "0").replace(/mon/gi, "1").replace(/tue/gi, "2").replace(/wed/gi, "3").replace(/thu/gi, "4").replace(/fri/gi, "5").replace(/sat/gi, "6");
  }
  replaceAlphaDaysQuartz(e) {
    return e.replace(/sun/gi, "1").replace(/mon/gi, "2").replace(/tue/gi, "3").replace(/wed/gi, "4").replace(/thu/gi, "5").replace(/fri/gi, "6").replace(/sat/gi, "7");
  }
  replaceAlphaMonths(e) {
    return e.replace(/jan/gi, "1").replace(/feb/gi, "2").replace(/mar/gi, "3").replace(/apr/gi, "4").replace(/may/gi, "5").replace(/jun/gi, "6").replace(/jul/gi, "7").replace(/aug/gi, "8").replace(/sep/gi, "9").replace(/oct/gi, "10").replace(/nov/gi, "11").replace(/dec/gi, "12");
  }
  handleNicknames(e) {
    let t = e.trim().toLowerCase();
    if (t === "@yearly" || t === "@annually")
      return "0 0 1 1 *";
    if (t === "@monthly")
      return "0 0 1 * *";
    if (t === "@weekly")
      return "0 0 * * 0";
    if (t === "@daily" || t === "@midnight")
      return "0 0 * * *";
    if (t === "@hourly")
      return "0 * * * *";
    if (t === "@reboot")
      throw new TypeError("CronPattern: @reboot is not supported in this environment. This is an event-based trigger that requires system startup detection.");
    return e;
  }
  setNthWeekdayOfMonth(e, t) {
    if (typeof t != "number" && t.toUpperCase() === "L")
      this.dayOfWeek[e] = this.dayOfWeek[e] | 32;
    else if (t === 63)
      this.dayOfWeek[e] = 63;
    else if (t < 6 && t > 0)
      this.dayOfWeek[e] = this.dayOfWeek[e] | O[t - 1];
    else
      throw new TypeError(`CronPattern: nth weekday out of range, should be 1-5 or L. Value: ${t}, Type: ${typeof t}`);
  }
};
var P = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var f = [["month", "year", 0], ["day", "month", -1], ["hour", "day", 0], ["minute", "hour", 0], ["second", "minute", 0]];
var m = class s {
  tz;
  ms;
  second;
  minute;
  hour;
  day;
  month;
  year;
  constructor(e, t) {
    if (this.tz = t, e && e instanceof Date)
      if (!isNaN(e))
        this.fromDate(e);
      else
        throw new TypeError("CronDate: Invalid date passed to CronDate constructor");
    else if (e == null)
      this.fromDate(new Date);
    else if (e && typeof e == "string")
      this.fromString(e);
    else if (e instanceof s)
      this.fromCronDate(e);
    else
      throw new TypeError("CronDate: Invalid type (" + typeof e + ") passed to CronDate constructor");
  }
  getLastDayOfMonth(e, t) {
    return t !== 1 ? P[t] : new Date(Date.UTC(e, t + 1, 0)).getUTCDate();
  }
  getLastWeekday(e, t) {
    let r = this.getLastDayOfMonth(e, t), i = new Date(Date.UTC(e, t, r)).getUTCDay();
    return i === 0 ? r - 2 : i === 6 ? r - 1 : r;
  }
  getNearestWeekday(e, t, r) {
    let n = this.getLastDayOfMonth(e, t);
    if (r > n)
      return -1;
    let a = new Date(Date.UTC(e, t, r)).getUTCDay();
    return a === 0 ? r === n ? r - 2 : r + 1 : a === 6 ? r === 1 ? r + 2 : r - 1 : r;
  }
  isNthWeekdayOfMonth(e, t, r, n) {
    let a = new Date(Date.UTC(e, t, r)).getUTCDay(), o = 0;
    for (let h = 1;h <= r; h++)
      new Date(Date.UTC(e, t, h)).getUTCDay() === a && o++;
    if (n & 63 && O[o - 1] & n)
      return true;
    if (n & 32) {
      let h = this.getLastDayOfMonth(e, t);
      for (let l = r + 1;l <= h; l++)
        if (new Date(Date.UTC(e, t, l)).getUTCDay() === a)
          return false;
      return true;
    }
    return false;
  }
  fromDate(e) {
    if (this.tz !== undefined)
      if (typeof this.tz == "number")
        this.ms = e.getUTCMilliseconds(), this.second = e.getUTCSeconds(), this.minute = e.getUTCMinutes() + this.tz, this.hour = e.getUTCHours(), this.day = e.getUTCDate(), this.month = e.getUTCMonth(), this.year = e.getUTCFullYear(), this.apply();
      else
        try {
          let t = g(e, this.tz);
          this.ms = e.getMilliseconds(), this.second = t.s, this.minute = t.i, this.hour = t.h, this.day = t.d, this.month = t.m - 1, this.year = t.y;
        } catch (t) {
          let r = t instanceof Error ? t.message : String(t);
          throw new TypeError(`CronDate: Failed to convert date to timezone '${this.tz}'. This may happen with invalid timezone names or dates. Original error: ${r}`);
        }
    else
      this.ms = e.getMilliseconds(), this.second = e.getSeconds(), this.minute = e.getMinutes(), this.hour = e.getHours(), this.day = e.getDate(), this.month = e.getMonth(), this.year = e.getFullYear();
  }
  fromCronDate(e) {
    this.tz = e.tz, this.year = e.year, this.month = e.month, this.day = e.day, this.hour = e.hour, this.minute = e.minute, this.second = e.second, this.ms = e.ms;
  }
  apply() {
    if (this.month > 11 || this.month < 0 || this.day > P[this.month] || this.day < 1 || this.hour > 59 || this.minute > 59 || this.second > 59 || this.hour < 0 || this.minute < 0 || this.second < 0) {
      let e = new Date(Date.UTC(this.year, this.month, this.day, this.hour, this.minute, this.second, this.ms));
      return this.ms = e.getUTCMilliseconds(), this.second = e.getUTCSeconds(), this.minute = e.getUTCMinutes(), this.hour = e.getUTCHours(), this.day = e.getUTCDate(), this.month = e.getUTCMonth(), this.year = e.getUTCFullYear(), true;
    } else
      return false;
  }
  fromString(e) {
    if (typeof this.tz == "number") {
      let t = v(e);
      this.ms = t.getUTCMilliseconds(), this.second = t.getUTCSeconds(), this.minute = t.getUTCMinutes(), this.hour = t.getUTCHours(), this.day = t.getUTCDate(), this.month = t.getUTCMonth(), this.year = t.getUTCFullYear(), this.apply();
    } else
      return this.fromDate(v(e, this.tz));
  }
  findNext(e, t, r, n) {
    return this._findMatch(e, t, r, n, 1);
  }
  _findMatch(e, t, r, n, i) {
    let a = this[t], o;
    r.lastDayOfMonth && (o = this.getLastDayOfMonth(this.year, this.month));
    let h = !r.starDOW && t == "day" ? new Date(Date.UTC(this.year, this.month, 1, 0, 0, 0, 0)).getUTCDay() : undefined, l = this[t] + n, y = i === 1 ? (u) => u < r[t].length : (u) => u >= 0;
    for (let u = l;y(u); u += i) {
      let d = r[t][u];
      if (t === "day" && !d) {
        for (let c = 0;c < r.nearestWeekdays.length; c++)
          if (r.nearestWeekdays[c]) {
            let M = this.getNearestWeekday(this.year, this.month, c - n);
            if (M === -1)
              continue;
            if (M === u - n) {
              d = 1;
              break;
            }
          }
      }
      if (t === "day" && r.lastWeekday) {
        let c = this.getLastWeekday(this.year, this.month);
        u - n === c && (d = 1);
      }
      if (t === "day" && r.lastDayOfMonth && u - n == o && (d = 1), t === "day" && !r.starDOW) {
        let c = r.dayOfWeek[(h + (u - n - 1)) % 7];
        if (c && c & 63)
          c = this.isNthWeekdayOfMonth(this.year, this.month, u - n, c) ? 1 : 0;
        else if (c)
          throw new Error(`CronDate: Invalid value for dayOfWeek encountered. ${c}`);
        r.useAndLogic ? d = d && c : !e.domAndDow && !r.starDOM ? d = d || c : d = d && c;
      }
      if (d)
        return this[t] = u - n, a !== this[t] ? 2 : 1;
    }
    return 3;
  }
  recurse(e, t, r) {
    if (r === 0 && !e.starYear) {
      if (this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0) {
        let i = -1;
        for (let a = this.year + 1;a < e.year.length && a < 1e4; a++)
          if (e.year[a] === 1) {
            i = a;
            break;
          }
        if (i === -1)
          return null;
        this.year = i, this.month = 0, this.day = 1, this.hour = 0, this.minute = 0, this.second = 0, this.ms = 0;
      }
      if (this.year >= 1e4)
        return null;
    }
    let n = this.findNext(t, f[r][0], e, f[r][2]);
    if (n > 1) {
      let i = r + 1;
      for (;i < f.length; )
        this[f[i][0]] = -f[i][2], i++;
      if (n === 3) {
        if (this[f[r][1]]++, this[f[r][0]] = -f[r][2], this.apply(), r === 0 && !e.starYear) {
          for (;this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0 && this.year < 1e4; )
            this.year++;
          if (this.year >= 1e4 || this.year >= e.year.length)
            return null;
        }
        return this.recurse(e, t, 0);
      } else if (this.apply())
        return this.recurse(e, t, r - 1);
    }
    return r += 1, r >= f.length ? this : (e.starYear ? this.year >= 3000 : this.year >= 1e4) ? null : this.recurse(e, t, r);
  }
  increment(e, t, r) {
    return this.second += t.interval !== undefined && t.interval > 1 && r ? t.interval : 1, this.ms = 0, this.apply(), this.recurse(e, t, 0);
  }
  decrement(e, t) {
    return this.second -= t.interval !== undefined && t.interval > 1 ? t.interval : 1, this.ms = 0, this.apply(), this.recurseBackward(e, t, 0, 0);
  }
  recurseBackward(e, t, r, n = 0) {
    if (n > 1e4)
      return null;
    if (r === 0 && !e.starYear) {
      if (this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0) {
        let a = -1;
        for (let o = this.year - 1;o >= 0; o--)
          if (e.year[o] === 1) {
            a = o;
            break;
          }
        if (a === -1)
          return null;
        this.year = a, this.month = 11, this.day = 31, this.hour = 23, this.minute = 59, this.second = 59, this.ms = 0;
      }
      if (this.year < 0)
        return null;
    }
    let i = this.findPrevious(t, f[r][0], e, f[r][2]);
    if (i > 1) {
      let a = r + 1;
      for (;a < f.length; ) {
        let o = f[a][0], h = f[a][2], l = this.getMaxPatternValue(o, e, h);
        this[o] = l, a++;
      }
      if (i === 3) {
        if (this[f[r][1]]--, r === 0) {
          let y = this.getLastDayOfMonth(this.year, this.month);
          this.day > y && (this.day = y);
        }
        if (r === 1)
          if (this.day <= 0)
            this.day = 1;
          else {
            let y = this.year, u = this.month;
            for (;u < 0; )
              u += 12, y--;
            for (;u > 11; )
              u -= 12, y++;
            let d = u !== 1 ? P[u] : new Date(Date.UTC(y, u + 1, 0)).getUTCDate();
            this.day > d && (this.day = d);
          }
        this.apply();
        let o = f[r][0], h = f[r][2], l = this.getMaxPatternValue(o, e, h);
        if (o === "day") {
          let y = this.getLastDayOfMonth(this.year, this.month);
          this[o] = Math.min(l, y);
        } else
          this[o] = l;
        if (this.apply(), r === 0) {
          let y = f[1][2], u = this.getMaxPatternValue("day", e, y), d = this.getLastDayOfMonth(this.year, this.month), c = Math.min(u, d);
          c !== this.day && (this.day = c, this.hour = this.getMaxPatternValue("hour", e, f[2][2]), this.minute = this.getMaxPatternValue("minute", e, f[3][2]), this.second = this.getMaxPatternValue("second", e, f[4][2]));
        }
        if (r === 0 && !e.starYear) {
          for (;this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0; )
            this.year--;
          if (this.year < 0)
            return null;
        }
        return this.recurseBackward(e, t, 0, n + 1);
      } else if (this.apply())
        return this.recurseBackward(e, t, r - 1, n + 1);
    }
    return r += 1, r >= f.length ? this : this.year < 0 ? null : this.recurseBackward(e, t, r, n + 1);
  }
  getMaxPatternValue(e, t, r) {
    if (e === "day" && t.lastDayOfMonth)
      return this.getLastDayOfMonth(this.year, this.month);
    if (e === "day" && !t.starDOW)
      return this.getLastDayOfMonth(this.year, this.month);
    for (let n = t[e].length - 1;n >= 0; n--)
      if (t[e][n])
        return n - r;
    return t[e].length - 1 - r;
  }
  findPrevious(e, t, r, n) {
    return this._findMatch(e, t, r, n, -1);
  }
  getDate(e) {
    return e || this.tz === undefined ? new Date(this.year, this.month, this.day, this.hour, this.minute, this.second, this.ms) : typeof this.tz == "number" ? new Date(Date.UTC(this.year, this.month, this.day, this.hour, this.minute - this.tz, this.second, this.ms)) : k(b(this.year, this.month + 1, this.day, this.hour, this.minute, this.second, this.tz), false);
  }
  getTime() {
    return this.getDate(false).getTime();
  }
  match(e, t) {
    if (!e.starYear && (this.year < 0 || this.year >= e.year.length || e.year[this.year] === 0))
      return false;
    for (let r = 0;r < f.length; r++) {
      let n = f[r][0], i = f[r][2], a = this[n];
      if (a + i < 0 || a + i >= e[n].length)
        return false;
      let o = e[n][a + i];
      if (n === "day") {
        if (!o) {
          for (let h = 0;h < e.nearestWeekdays.length; h++)
            if (e.nearestWeekdays[h]) {
              let l = this.getNearestWeekday(this.year, this.month, h - i);
              if (l !== -1 && l === a) {
                o = 1;
                break;
              }
            }
        }
        if (e.lastWeekday) {
          let h = this.getLastWeekday(this.year, this.month);
          a === h && (o = 1);
        }
        if (e.lastDayOfMonth) {
          let h = this.getLastDayOfMonth(this.year, this.month);
          a === h && (o = 1);
        }
        if (!e.starDOW) {
          let h = new Date(Date.UTC(this.year, this.month, 1, 0, 0, 0, 0)).getUTCDay(), l = e.dayOfWeek[(h + (a - 1)) % 7];
          l && l & 63 && (l = this.isNthWeekdayOfMonth(this.year, this.month, a, l) ? 1 : 0), e.useAndLogic ? o = o && l : !t.domAndDow && !e.starDOM ? o = o || l : o = o && l;
        }
      }
      if (!o)
        return false;
    }
    return true;
  }
};
function R(s2) {
  if (s2 === undefined && (s2 = {}), delete s2.name, s2.legacyMode !== undefined && s2.domAndDow === undefined ? s2.domAndDow = !s2.legacyMode : s2.domAndDow === undefined && (s2.domAndDow = false), s2.legacyMode = !s2.domAndDow, s2.paused = s2.paused === undefined ? false : s2.paused, s2.maxRuns = s2.maxRuns === undefined ? 1 / 0 : s2.maxRuns, s2.catch = s2.catch === undefined ? false : s2.catch, s2.interval = s2.interval === undefined ? 0 : parseInt(s2.interval.toString(), 10), s2.utcOffset = s2.utcOffset === undefined ? undefined : parseInt(s2.utcOffset.toString(), 10), s2.dayOffset = s2.dayOffset === undefined ? 0 : parseInt(s2.dayOffset.toString(), 10), s2.unref = s2.unref === undefined ? false : s2.unref, s2.mode = s2.mode === undefined ? "auto" : s2.mode, s2.alternativeWeekdays = s2.alternativeWeekdays === undefined ? false : s2.alternativeWeekdays, s2.sloppyRanges = s2.sloppyRanges === undefined ? false : s2.sloppyRanges, !["auto", "5-part", "6-part", "7-part", "5-or-6-parts", "6-or-7-parts"].includes(s2.mode))
    throw new Error("CronOptions: mode must be one of 'auto', '5-part', '6-part', '7-part', '5-or-6-parts', or '6-or-7-parts'.");
  if (s2.startAt && (s2.startAt = new m(s2.startAt, s2.timezone)), s2.stopAt && (s2.stopAt = new m(s2.stopAt, s2.timezone)), s2.interval !== null) {
    if (isNaN(s2.interval))
      throw new Error("CronOptions: Supplied value for interval is not a number");
    if (s2.interval < 0)
      throw new Error("CronOptions: Supplied value for interval can not be negative");
  }
  if (s2.utcOffset !== undefined) {
    if (isNaN(s2.utcOffset))
      throw new Error("CronOptions: Invalid value passed for utcOffset, should be number representing minutes offset from UTC.");
    if (s2.utcOffset < -870 || s2.utcOffset > 870)
      throw new Error("CronOptions: utcOffset out of bounds.");
    if (s2.utcOffset !== undefined && s2.timezone)
      throw new Error("CronOptions: Combining 'utcOffset' with 'timezone' is not allowed.");
  }
  if (s2.unref !== true && s2.unref !== false)
    throw new Error("CronOptions: Unref should be either true, false or undefined(false).");
  if (s2.dayOffset !== undefined && s2.dayOffset !== 0 && isNaN(s2.dayOffset))
    throw new Error("CronOptions: Invalid value passed for dayOffset, should be a number representing days to offset.");
  return s2;
}
function p(s2) {
  return Object.prototype.toString.call(s2) === "[object Function]" || typeof s2 == "function" || s2 instanceof Function;
}
function _(s2) {
  return p(s2);
}
function x(s2) {
  typeof Deno < "u" && typeof Deno.unrefTimer < "u" ? Deno.unrefTimer(s2) : s2 && typeof s2.unref < "u" && s2.unref();
}
var W = 30 * 1000;
var w = [];
var E = class {
  name;
  options;
  _states;
  fn;
  getTz() {
    return this.options.timezone || this.options.utcOffset;
  }
  applyDayOffset(e) {
    if (this.options.dayOffset !== undefined && this.options.dayOffset !== 0) {
      let t = this.options.dayOffset * 24 * 60 * 60 * 1000;
      return new Date(e.getTime() + t);
    }
    return e;
  }
  constructor(e, t, r) {
    let n, i;
    if (p(t))
      i = t;
    else if (typeof t == "object")
      n = t;
    else if (t !== undefined)
      throw new Error("Cron: Invalid argument passed for optionsIn. Should be one of function, or object (options).");
    if (p(r))
      i = r;
    else if (typeof r == "object")
      n = r;
    else if (r !== undefined)
      throw new Error("Cron: Invalid argument passed for funcIn. Should be one of function, or object (options).");
    if (this.name = n?.name, this.options = R(n), this._states = { kill: false, blocking: false, previousRun: undefined, currentRun: undefined, once: undefined, currentTimeout: undefined, maxRuns: n ? n.maxRuns : undefined, paused: n ? n.paused : false, pattern: new C("* * * * *", undefined, { mode: "auto" }) }, e && (e instanceof Date || typeof e == "string" && e.indexOf(":") > 0) ? this._states.once = new m(e, this.getTz()) : this._states.pattern = new C(e, this.options.timezone, { mode: this.options.mode, alternativeWeekdays: this.options.alternativeWeekdays, sloppyRanges: this.options.sloppyRanges }), this.name) {
      if (w.find((o) => o.name === this.name))
        throw new Error("Cron: Tried to initialize new named job '" + this.name + "', but name already taken.");
      w.push(this);
    }
    return i !== undefined && _(i) && (this.fn = i, this.schedule()), this;
  }
  nextRun(e) {
    let t = this._next(e);
    return t ? this.applyDayOffset(t.getDate(false)) : null;
  }
  nextRuns(e, t) {
    this._states.maxRuns !== undefined && e > this._states.maxRuns && (e = this._states.maxRuns);
    let r = t || this._states.currentRun || undefined;
    return this._enumerateRuns(e, r, "next");
  }
  previousRuns(e, t) {
    return this._enumerateRuns(e, t || undefined, "previous");
  }
  _enumerateRuns(e, t, r) {
    let n = [], i = t ? new m(t, this.getTz()) : null, a = r === "next" ? this._next : this._previous;
    for (;e--; ) {
      let o = a.call(this, i);
      if (!o)
        break;
      let h = o.getDate(false);
      n.push(this.applyDayOffset(h)), i = o;
    }
    return n;
  }
  match(e) {
    if (this._states.once) {
      let r = new m(e, this.getTz());
      r.ms = 0;
      let n = new m(this._states.once, this.getTz());
      return n.ms = 0, r.getTime() === n.getTime();
    }
    let t = new m(e, this.getTz());
    return t.ms = 0, t.match(this._states.pattern, this.options);
  }
  getPattern() {
    if (!this._states.once)
      return this._states.pattern ? this._states.pattern.pattern : undefined;
  }
  getOnce() {
    return this._states.once ? this._states.once.getDate() : null;
  }
  isRunning() {
    let e = this.nextRun(this._states.currentRun), t = !this._states.paused, r = this.fn !== undefined, n = !this._states.kill;
    return t && r && n && e !== null;
  }
  isStopped() {
    return this._states.kill;
  }
  isBusy() {
    return this._states.blocking;
  }
  currentRun() {
    return this._states.currentRun ? this._states.currentRun.getDate() : null;
  }
  previousRun() {
    return this._states.previousRun ? this._states.previousRun.getDate() : null;
  }
  msToNext(e) {
    let t = this._next(e);
    return t ? e instanceof m || e instanceof Date ? t.getTime() - e.getTime() : t.getTime() - new m(e).getTime() : null;
  }
  stop() {
    this._states.kill = true, this._states.currentTimeout && clearTimeout(this._states.currentTimeout);
    let e = w.indexOf(this);
    e >= 0 && w.splice(e, 1);
  }
  pause() {
    return this._states.paused = true, !this._states.kill;
  }
  resume() {
    return this._states.paused = false, !this._states.kill;
  }
  schedule(e) {
    if (e && this.fn)
      throw new Error("Cron: It is not allowed to schedule two functions using the same Croner instance.");
    e && (this.fn = e);
    let t = this.msToNext(), r = this.nextRun(this._states.currentRun);
    return t == null || isNaN(t) || r === null ? this : (t > W && (t = W), this._states.currentTimeout = setTimeout(() => this._checkTrigger(r), t), this._states.currentTimeout && this.options.unref && x(this._states.currentTimeout), this);
  }
  async _trigger(e) {
    this._states.blocking = true, this._states.currentRun = new m(undefined, this.getTz());
    try {
      if (this.options.catch)
        try {
          this.fn !== undefined && await this.fn(this, this.options.context);
        } catch (t) {
          if (p(this.options.catch))
            try {
              this.options.catch(t, this);
            } catch {}
        }
      else
        this.fn !== undefined && await this.fn(this, this.options.context);
    } finally {
      this._states.previousRun = new m(e, this.getTz()), this._states.blocking = false;
    }
  }
  async trigger() {
    await this._trigger();
  }
  runsLeft() {
    return this._states.maxRuns;
  }
  _checkTrigger(e) {
    let t = new Date, r = !this._states.paused && t.getTime() >= e.getTime(), n = this._states.blocking && this.options.protect;
    r && !n ? (this._states.maxRuns !== undefined && this._states.maxRuns--, this._trigger()) : r && n && p(this.options.protect) && setTimeout(() => this.options.protect(this), 0), this.schedule();
  }
  _next(e) {
    let t = !!(e || this._states.currentRun), r = false;
    !e && this.options.startAt && this.options.interval && ([e, t] = this._calculatePreviousRun(e, t), r = !e), e = new m(e, this.getTz()), this.options.startAt && e && e.getTime() < this.options.startAt.getTime() && (e = this.options.startAt);
    let n = this._states.once || new m(e, this.getTz());
    return !r && n !== this._states.once && (n = n.increment(this._states.pattern, this.options, t)), this._states.once && this._states.once.getTime() <= e.getTime() || n === null || this._states.maxRuns !== undefined && this._states.maxRuns <= 0 || this._states.kill || this.options.stopAt && n.getTime() >= this.options.stopAt.getTime() ? null : n;
  }
  _previous(e) {
    let t = new m(e, this.getTz());
    this.options.stopAt && t.getTime() > this.options.stopAt.getTime() && (t = this.options.stopAt);
    let r = new m(t, this.getTz());
    return this._states.once ? this._states.once.getTime() < t.getTime() ? this._states.once : null : (r = r.decrement(this._states.pattern, this.options), r === null || this.options.startAt && r.getTime() < this.options.startAt.getTime() ? null : r);
  }
  _calculatePreviousRun(e, t) {
    let r = new m(undefined, this.getTz()), n = e;
    if (this.options.startAt.getTime() <= r.getTime()) {
      n = this.options.startAt;
      let i = n.getTime() + this.options.interval * 1000;
      for (;i <= r.getTime(); )
        n = new m(n, this.getTz()).increment(this._states.pattern, this.options, true), i = n.getTime() + this.options.interval * 1000;
      t = true;
    }
    return n === null && (n = undefined), [n, t];
  }
};

// extensions/cron/src/types.ts
var DEFAULT_SCHEDULER_CONFIG = {
  enabled: true,
  quietHours: {
    enabled: false,
    windows: [{ start: "23:00", end: "07:00" }],
    allowUrgent: true
  },
  skipIfRecentActivity: {
    enabled: true,
    withinMinutes: 5
  }
};
var DEFAULT_CRON_SYSTEM_PROMPT = `你是一个自动化定时任务执行器。

你的职责是执行用户预设的定时任务指令，完成后输出简洁的执行报告。

注意事项：
- 你在后台独立运行，没有用户正在与你对话
- 你的输出将作为通知推送给用户，请保持简洁明了
- 如果任务涉及文件操作，请使用可用的工具完成
- 完成后直接给出结论，不需要寒暄或确认`;
var DEFAULT_EXCLUDE_TOOLS = ["sub_agent", "history_search", "manage_scheduled_tasks"];
var DEFAULT_BACKGROUND_CONFIG = {
  systemPrompt: DEFAULT_CRON_SYSTEM_PROMPT,
  excludeTools: [...DEFAULT_EXCLUDE_TOOLS],
  maxToolRounds: 50,
  timeoutMs: 5 * 60 * 1000,
  maxConcurrent: 3,
  retentionDays: 30,
  retentionCount: 100
};

// extensions/cron/src/delivery-gate.ts
var logger = createPluginLogger("cron", "condition");
function parseTimeToMinutes(time) {
  const parts = time.split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`无效的时间格式: "${time}"，应为 HH:MM`);
  }
  return hours * 60 + minutes;
}
function isInTimeWindow(now, window) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(window.start);
  const endMinutes = parseTimeToMinutes(window.end);
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
function isInQuietHours(config, now) {
  if (!config.quietHours.enabled)
    return false;
  for (const window of config.quietHours.windows) {
    if (isInTimeWindow(now, window))
      return true;
  }
  return false;
}
function hasRecentActivity(config, sessionId, lastActivityMap, now) {
  if (!config.skipIfRecentActivity.enabled)
    return false;
  const lastActivity = lastActivityMap.get(sessionId);
  if (lastActivity === undefined)
    return false;
  const thresholdMs = config.skipIfRecentActivity.withinMinutes * 60 * 1000;
  return now - lastActivity < thresholdMs;
}
function evaluateCondition(expression, globalStore, agentName, sessionId) {
  const agentVars = globalStore.agent(agentName).getAll();
  const sessionVars = sessionId ? globalStore.session(sessionId).getAll() : {};
  const globalVars = {};
  for (const key of globalStore.keys()) {
    if (!key.startsWith("@")) {
      globalVars[key] = globalStore.get(key);
    }
  }
  try {
    const fn = new Function("agent", "session", "global", "random", "now", "hour", "day", "Math", "Date", `"use strict"; return (${expression})`);
    const result = fn(agentVars, sessionVars, globalVars, () => Math.random(), () => Date.now(), () => new Date().getHours(), () => new Date().getDay(), Math, Date);
    return { pass: !!result, detail: `表达式求值结果: ${result}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`条件表达式求值失败: "${expression}", error: ${msg}`);
    return { pass: false, detail: `表达式错误: ${msg}` };
  }
}
function shouldSkip(job, config, lastActivityMap, context, now) {
  const currentDate = now ?? new Date;
  const currentTimestamp = currentDate.getTime();
  if (!job.enabled) {
    return { skip: true, reason: `任务 "${job.name}" 已禁用` };
  }
  if (isInQuietHours(config, currentDate)) {
    if (job.urgent && config.quietHours.allowUrgent) {} else {
      return {
        skip: true,
        reason: `当前处于安静时段，任务 "${job.name}" 被跳过`
      };
    }
  }
  const targetSessionId = job.delivery.sessionId ?? job.sessionId;
  if (hasRecentActivity(config, targetSessionId, lastActivityMap, currentTimestamp)) {
    return {
      skip: true,
      reason: `会话 ${targetSessionId} 在 ${config.skipIfRecentActivity.withinMinutes} 分钟内有活动，跳过任务 "${job.name}"`
    };
  }
  if (job.condition && context?.globalStore) {
    const { pass, detail } = evaluateCondition(job.condition, context.globalStore, context.agentName ?? "master", targetSessionId);
    if (!pass) {
      return {
        skip: true,
        reason: `条件未满足: "${job.condition}" — ${detail}，跳过任务 "${job.name}"`
      };
    }
  }
  return { skip: false };
}

// extensions/cron/src/scheduler.ts
var logger2 = createPluginLogger("cron");
function generateId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v2 = c === "x" ? r : r & 3 | 8;
    return v2.toString(16);
  });
}
var cronTaskCounter = 0;
function createCronTaskId() {
  return `cron_task_${++cronTaskCounter}_${Date.now()}`;
}
function normalizeRunStatus(status) {
  if (!status)
    return;
  if (status === "success")
    return "completed";
  return status;
}

class CronScheduler {
  jobs = new Map;
  lastActivityMap = new Map;
  config;
  filePath;
  api;
  persistTimer = null;
  fileWatcherActive = false;
  lastFileModTime = 0;
  running = false;
  taskBoard = null;
  agentName = "master";
  backgroundConfig;
  runsDir;
  executorJobMap = new WeakMap;
  handleTaskBoardRegistered = (task) => {
    if (task.type !== "cron" || !task.executor)
      return;
    const job = this.executorJobMap.get(task.executor);
    if (!job)
      return;
    job.currentTaskId = task.taskId;
  };
  constructor(api, config, taskBoard, agentName, backgroundConfig, dataDir) {
    this.api = api;
    this.config = config ? { ...config } : { ...DEFAULT_SCHEDULER_CONFIG };
    this.taskBoard = taskBoard ?? null;
    this.agentName = agentName ?? "master";
    this.backgroundConfig = { ...DEFAULT_BACKGROUND_CONFIG, ...backgroundConfig };
    const dir = dataDir ?? api.dataDir ?? resolveDefaultDataDir();
    this.filePath = path2.join(dir, "cron-jobs.json");
    this.runsDir = path2.join(dir, "cron-runs");
  }
  async start() {
    if (this.running)
      return;
    this.running = true;
    this.loadFromFile();
    this.reconcileJobsOnStartup();
    this.taskBoard?.on?.("registered", this.handleTaskBoardRegistered);
    for (const job of this.jobs.values()) {
      if (job.enabled) {
        this.registerJobToTaskBoard(job);
      }
    }
    this.startFileWatcher();
    logger2.info(`调度器已启动，共 ${this.jobs.size} 个任务`);
  }
  stop() {
    this.running = false;
    for (const job of this.jobs.values()) {
      if (job.currentTaskId) {
        this.taskBoard?.kill(job.currentTaskId);
        job.currentTaskId = undefined;
      }
    }
    this.taskBoard?.off?.("registered", this.handleTaskBoardRegistered);
    this.stopFileWatcher();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistSync();
    logger2.info("调度器已停止");
  }
  createJob(params) {
    const job = {
      id: generateId(),
      name: params.name,
      schedule: params.schedule,
      sessionId: params.sessionId,
      instruction: params.instruction,
      delivery: {
        sessionId: params.delivery?.sessionId,
        fallback: params.delivery?.fallback ?? "last-active"
      },
      silent: params.silent ?? false,
      urgent: params.urgent ?? false,
      condition: params.condition,
      allowedTools: params.allowedTools?.length ? params.allowedTools : undefined,
      excludeTools: !params.allowedTools?.length && params.excludeTools?.length ? params.excludeTools : undefined,
      enabled: true,
      createdAt: Date.now(),
      createdInSession: params.createdInSession
    };
    this.jobs.set(job.id, job);
    if (job.enabled) {
      this.registerJobToTaskBoard(job);
    }
    this.debouncePersist();
    logger2.info(`任务已创建: ${job.name} (${job.id})`);
    return job;
  }
  updateJob(id, params) {
    const job = this.jobs.get(id);
    if (!job)
      return null;
    if (params.name !== undefined)
      job.name = params.name;
    if (params.schedule !== undefined)
      job.schedule = params.schedule;
    if (params.instruction !== undefined)
      job.instruction = params.instruction;
    if (params.delivery !== undefined) {
      job.delivery = { ...job.delivery, ...params.delivery };
    }
    if (params.silent !== undefined)
      job.silent = params.silent;
    if (params.urgent !== undefined)
      job.urgent = params.urgent;
    if (params.condition !== undefined)
      job.condition = params.condition || undefined;
    if (params.allowedTools !== undefined && params.allowedTools.length > 0) {
      job.allowedTools = params.allowedTools;
      job.excludeTools = undefined;
    } else if (params.excludeTools !== undefined && params.excludeTools.length > 0) {
      job.excludeTools = params.excludeTools;
      job.allowedTools = undefined;
    } else {
      if (params.allowedTools !== undefined)
        job.allowedTools = undefined;
      if (params.excludeTools !== undefined)
        job.excludeTools = undefined;
    }
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
      job.currentTaskId = undefined;
    }
    if (job.enabled) {
      this.registerJobToTaskBoard(job);
    }
    this.debouncePersist();
    logger2.info(`任务已更新: ${job.name} (${id})`);
    return job;
  }
  deleteJob(id) {
    const job = this.jobs.get(id);
    if (!job)
      return false;
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
    }
    this.jobs.delete(id);
    this.debouncePersist();
    logger2.info(`任务已删除: ${job.name} (${id})`);
    return true;
  }
  enableJob(id) {
    const job = this.jobs.get(id);
    if (!job)
      return null;
    if (job.schedule.type === "once" && job.schedule.at - Date.now() <= 0) {
      logger2.warn(`拒绝启用已过期的一次性任务: ${job.name} (${id}), ` + `原定时间=${new Date(job.schedule.at).toISOString()}`);
      return null;
    }
    job.enabled = true;
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
    }
    this.registerJobToTaskBoard(job);
    this.debouncePersist();
    logger2.info(`任务已启用: ${job.name} (${id})`);
    return job;
  }
  disableJob(id) {
    const job = this.jobs.get(id);
    if (!job)
      return null;
    job.enabled = false;
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
      job.currentTaskId = undefined;
    }
    this.debouncePersist();
    logger2.info(`任务已禁用: ${job.name} (${id})`);
    return job;
  }
  getJob(id) {
    return this.jobs.get(id);
  }
  listJobs() {
    return Array.from(this.jobs.values());
  }
  getConfig() {
    return this.config;
  }
  updateConfig(newConfig) {
    if (newConfig.enabled !== undefined) {
      this.config.enabled = newConfig.enabled;
    }
    if (newConfig.quietHours) {
      this.config.quietHours = {
        ...this.config.quietHours,
        ...newConfig.quietHours
      };
    }
    if (newConfig.skipIfRecentActivity) {
      this.config.skipIfRecentActivity = {
        ...this.config.skipIfRecentActivity,
        ...newConfig.skipIfRecentActivity
      };
    }
    logger2.info("调度器配置已热更新");
  }
  recordActivity(sessionId) {
    this.lastActivityMap.set(sessionId, Date.now());
  }
  reconcileJobsOnStartup() {
    let changed = false;
    for (const job of this.jobs.values()) {
      if (job.lastRunStatus === "running") {
        job.lastRunStatus = "error";
        job.lastRunError = "进程重启前任务仍在执行中（僵尸任务恢复）";
        if (job.schedule.type === "once") {
          job.enabled = false;
        }
        changed = true;
        logger2.warn(`僵尸任务恢复: ${job.name} (${job.id}), type=${job.schedule.type}`);
        continue;
      }
      if (job.schedule.type !== "once")
        continue;
      const isExpired = job.schedule.at - Date.now() <= 0;
      if (isExpired && (job.lastRunStatus === "completed" || job.lastRunStatus === "success" || job.lastRunStatus === "error" || job.lastRunStatus === "missed")) {
        if (job.enabled) {
          job.enabled = false;
          changed = true;
          logger2.info(`一次性任务已完结，确保禁用: ${job.name} (${job.id}), status=${job.lastRunStatus}`);
        }
        continue;
      }
      if (isExpired) {
        job.lastRunStatus = "missed";
        job.lastRunAt = Date.now();
        job.enabled = false;
        changed = true;
        logger2.warn(`一次性任务已过期，标记为 missed: ${job.name} (${job.id})`);
        continue;
      }
    }
    if (changed) {
      this.debouncePersist();
    }
  }
  registerJobToTaskBoard(job) {
    if (!this.taskBoard || !job.enabled || !this.running)
      return;
    const schedule = this.buildScheduleConfig(job);
    if (!schedule) {
      logger2.warn(`任务未注册到 TaskBoard（无有效下次执行时间）: ${job.name} (${job.id})`);
      return;
    }
    const executor = async (taskId2, signal) => {
      return this.executeCronJob(job, taskId2, signal);
    };
    this.executorJobMap.set(executor, job);
    const nextTimeResolver = job.schedule.type === "cron" ? (source) => {
      if (source.kind !== "cron")
        return null;
      const next = new E(source.expression).nextRun();
      return next?.getTime() ?? null;
    } : undefined;
    const taskId = createCronTaskId();
    const targetSessionId = job.delivery.sessionId ?? job.sessionId;
    this.taskBoard.register({
      taskId,
      sourceAgent: this.agentName,
      sourceSessionId: targetSessionId,
      targetAgent: this.agentName,
      type: "cron",
      description: `定时任务: ${job.name}`,
      silent: job.silent,
      schedule,
      executor,
      nextTimeResolver
    });
    job.currentTaskId = taskId;
    this.debouncePersist();
  }
  buildScheduleConfig(job) {
    switch (job.schedule.type) {
      case "cron": {
        const next = new E(job.schedule.expression).nextRun();
        if (!next)
          return null;
        return {
          type: "recurring",
          nextRunAt: next.getTime(),
          source: { kind: "cron", expression: job.schedule.expression }
        };
      }
      case "interval":
        return {
          type: "recurring",
          nextRunAt: Date.now() + job.schedule.ms,
          source: { kind: "interval", intervalMs: job.schedule.ms }
        };
      case "once": {
        const delayMs = job.schedule.at - Date.now();
        if (delayMs <= 0)
          return null;
        return { type: "once", runAt: job.schedule.at };
      }
    }
  }
  async executeCronJob(job, taskId, signal) {
    const currentJob = this.jobs.get(job.id) ?? job;
    if (!currentJob.enabled) {
      logger2.info(`任务已禁用，跳过执行: ${currentJob.name} (${currentJob.id})`);
      return;
    }
    const decision = shouldSkip(currentJob, this.config, this.lastActivityMap, {
      globalStore: this.api.globalStore,
      agentName: this.agentName
    });
    if (decision.skip) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = "skipped";
      if (currentJob.schedule.type === "once") {
        currentJob.enabled = false;
      }
      currentJob.currentTaskId = undefined;
      logger2.info(`任务被跳过: ${currentJob.name} — ${decision.reason}`);
      this.debouncePersist();
      return;
    }
    const cronRunning = this.taskBoard ? this.taskBoard.getRunningByTargetAgent(this.agentName).filter((task) => task.type === "cron" && task.taskId !== taskId) : [];
    if (cronRunning.length >= this.backgroundConfig.maxConcurrent) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = "skipped";
      currentJob.lastRunError = `并发后台任务数已达上限 (${this.backgroundConfig.maxConcurrent})`;
      if (currentJob.schedule.type === "once") {
        currentJob.enabled = false;
      }
      currentJob.currentTaskId = undefined;
      logger2.warn(`任务被跳过（并发上限）: ${currentJob.name}`);
      this.debouncePersist();
      return;
    }
    currentJob.lastRunAt = Date.now();
    currentJob.lastRunStatus = "running";
    currentJob.lastRunError = undefined;
    if (currentJob.schedule.type === "once") {
      currentJob.enabled = false;
    }
    currentJob.currentTaskId = taskId;
    this.debouncePersist();
    await this.runCronJobInBackground(currentJob, taskId, signal);
  }
  async runCronJobInBackground(job, taskId, signal) {
    const startTime = Date.now();
    const board = this.taskBoard;
    const timeoutHandle = setTimeout(() => {
      board.kill(taskId);
      logger2.warn(`后台任务超时 (${this.backgroundConfig.timeoutMs}ms): ${job.name}`);
    }, this.backgroundConfig.timeoutMs);
    if (timeoutHandle.unref)
      timeoutHandle.unref();
    try {
      let cronTools;
      if (job.allowedTools && job.allowedTools.length > 0) {
        cronTools = this.api.tools.createSubset?.(job.allowedTools) ?? this.api.tools;
      } else if (job.excludeTools && job.excludeTools.length > 0) {
        cronTools = this.api.tools.createFiltered?.(job.excludeTools) ?? this.api.tools;
      } else {
        cronTools = this.backgroundConfig.excludeTools.length > 0 ? this.api.tools.createFiltered?.(this.backgroundConfig.excludeTools) ?? this.api.tools : this.api.tools;
      }
      const systemPrompt = this.backgroundConfig.systemPrompt;
      if (typeof this.api.createToolLoop !== "function") {
        throw new Error("IrisAPI.createToolLoop 不可用，无法执行后台任务");
      }
      const toolLoop = this.api.createToolLoop({
        tools: cronTools,
        systemPrompt,
        maxRounds: this.backgroundConfig.maxToolRounds
      });
      const router = this.api.router;
      const callLLM = async (request, modelName, sig) => {
        if (router.chatStream) {
          const parts = [];
          let usageMetadata;
          for await (const chunk of router.chatStream(request, modelName, sig)) {
            board.emitChunkHeartbeat(taskId);
            if (chunk.partsDelta && chunk.partsDelta.length > 0) {
              for (const part of chunk.partsDelta) {
                parts.push(part);
              }
            } else {
              if (chunk.textDelta)
                parts.push({ text: chunk.textDelta });
              if (chunk.functionCalls) {
                for (const fc of chunk.functionCalls)
                  parts.push(fc);
              }
            }
            if (chunk.usageMetadata) {
              usageMetadata = chunk.usageMetadata;
              const tokens = usageMetadata.totalTokenCount ?? usageMetadata.candidatesTokenCount ?? 0;
              if (tokens > 0) {
                board.updateTokens(taskId, tokens);
              }
            }
          }
          if (parts.length === 0)
            parts.push({ text: "" });
          const content = { role: "model", parts, createdAt: Date.now() };
          if (usageMetadata)
            content.usageMetadata = usageMetadata;
          return content;
        }
        if (!router.chat) {
          throw new Error("LLMRouter 既不支持 chatStream 也不支持 chat，无法调用 LLM");
        }
        const response = await router.chat(request, modelName, sig);
        return response.content;
      };
      const history = [];
      const userInstruction = job.instruction;
      history.push({ role: "user", parts: [{ text: userInstruction }] });
      const result = await toolLoop.run(history, callLLM, { signal });
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const finalText = result.text ?? "";
      const loopError = result.error;
      if (result.aborted) {
        board.kill(taskId);
        job.lastRunStatus = "error";
        job.lastRunError = "后台任务被中止";
        this.saveRunRecord({
          runId: taskId,
          jobId: job.id,
          jobName: job.name,
          instruction: job.instruction,
          startTime,
          endTime,
          durationMs,
          status: "killed"
        });
        logger2.info(`后台任务被中止: ${job.name} (taskId=${taskId})`);
      } else if (loopError) {
        board.fail(taskId, loopError);
        job.lastRunStatus = "error";
        job.lastRunError = loopError;
        this.saveRunRecord({
          runId: taskId,
          jobId: job.id,
          jobName: job.name,
          instruction: job.instruction,
          startTime,
          endTime,
          durationMs,
          status: "failed",
          error: loopError
        });
        logger2.error(`后台任务失败: ${job.name} (taskId=${taskId}), error="${loopError}"`);
      } else {
        board.complete(taskId, finalText);
        job.lastRunStatus = "completed";
        job.lastRunError = undefined;
        this.saveRunRecord({
          runId: taskId,
          jobId: job.id,
          jobName: job.name,
          instruction: job.instruction,
          startTime,
          endTime,
          durationMs,
          status: "completed",
          resultText: finalText
        });
        logger2.info(`后台任务完成: ${job.name} (taskId=${taskId}), duration=${durationMs}ms`);
      }
    } catch (err) {
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      board.fail(taskId, errorMsg);
      job.lastRunStatus = "error";
      job.lastRunError = errorMsg;
      this.saveRunRecord({
        runId: taskId,
        jobId: job.id,
        jobName: job.name,
        instruction: job.instruction,
        startTime,
        endTime,
        durationMs,
        status: "failed",
        error: errorMsg
      });
      logger2.error(`后台任务异常: ${job.name} (taskId=${taskId}), error="${errorMsg}"`);
    } finally {
      job.currentTaskId = undefined;
      clearTimeout(timeoutHandle);
      this.debouncePersist();
      this.cleanupOldRuns();
    }
  }
  saveRunRecord(record) {
    try {
      if (!fs.existsSync(this.runsDir)) {
        fs.mkdirSync(this.runsDir, { recursive: true });
      }
      const filename = `${record.jobId}_${record.startTime}.json`;
      const filePath = path2.join(this.runsDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
    } catch (err) {
      logger2.warn(`保存执行记录失败: ${err}`);
    }
  }
  cleanupOldRuns() {
    try {
      if (!fs.existsSync(this.runsDir))
        return;
      const files = fs.readdirSync(this.runsDir).filter((f2) => f2.endsWith(".json")).sort();
      const now = Date.now();
      const retentionMs = this.backgroundConfig.retentionDays * 24 * 60 * 60 * 1000;
      let deleted = 0;
      for (const file of files) {
        const match = file.match(/_([\d]+)\.json$/);
        if (match) {
          const timestamp = parseInt(match[1], 10);
          if (now - timestamp > retentionMs) {
            try {
              fs.unlinkSync(path2.join(this.runsDir, file));
              deleted++;
            } catch {}
          }
        }
      }
      const remaining = fs.readdirSync(this.runsDir).filter((f2) => f2.endsWith(".json")).sort();
      if (remaining.length > this.backgroundConfig.retentionCount) {
        const toDelete = remaining.slice(0, remaining.length - this.backgroundConfig.retentionCount);
        for (const file of toDelete) {
          try {
            fs.unlinkSync(path2.join(this.runsDir, file));
            deleted++;
          } catch {}
        }
      }
      if (deleted > 0) {
        logger2.info(`清理了 ${deleted} 条过期执行记录`);
      }
    } catch (err) {
      logger2.warn(`清理执行记录失败: ${err}`);
    }
  }
  listRuns(limit = 50) {
    try {
      if (!fs.existsSync(this.runsDir))
        return [];
      const files = fs.readdirSync(this.runsDir).filter((f2) => f2.endsWith(".json")).sort().reverse().slice(0, limit);
      const records = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path2.join(this.runsDir, file), "utf-8");
          records.push(JSON.parse(raw));
        } catch {}
      }
      return records;
    } catch {
      return [];
    }
  }
  getRunRecord(runId) {
    try {
      if (!fs.existsSync(this.runsDir))
        return null;
      const files = fs.readdirSync(this.runsDir).filter((f2) => f2.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path2.join(this.runsDir, file), "utf-8");
          const record = JSON.parse(raw);
          if (record.runId === runId)
            return record;
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
  }
  debouncePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistSync();
      this.persistTimer = null;
    }, 500);
  }
  persistSync() {
    try {
      const dir = path2.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        try {
          const stat = fs.statSync(this.filePath);
          if (stat.mtimeMs > this.lastFileModTime) {
            this.onFileChanged();
          }
        } catch {}
      }
      const data = JSON.stringify(Array.from(this.jobs.values()), null, 2);
      fs.writeFileSync(this.filePath, data, "utf-8");
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {}
    } catch (err) {
      logger2.error(`持久化写入失败: ${err}`);
    }
  }
  loadFromFile() {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger2.info("持久化文件不存在，从空白状态启动");
        return;
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
        this.jobs.set(job.id, job);
      }
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {}
      logger2.info(`从文件恢复了 ${parsed.length} 个任务`);
    } catch (err) {
      logger2.error(`从文件加载任务失败: ${err}`);
    }
  }
  startFileWatcher() {
    try {
      fs.watchFile(this.filePath, { interval: 2000 }, (curr) => {
        if (curr.mtimeMs > this.lastFileModTime) {
          this.onFileChanged();
        }
      });
      this.fileWatcherActive = true;
    } catch (err) {
      logger2.warn(`启动文件监听失败: ${err}`);
    }
  }
  stopFileWatcher() {
    if (this.fileWatcherActive) {
      try {
        fs.unwatchFile(this.filePath);
      } catch {}
      this.fileWatcherActive = false;
    }
  }
  shouldRescheduleAfterFileSync(existing, incoming) {
    return existing.enabled !== incoming.enabled || JSON.stringify(existing.schedule) !== JSON.stringify(incoming.schedule);
  }
  syncJobInPlace(target, source) {
    for (const key of Object.keys(target)) {
      if (!(key in source)) {
        delete target[key];
      }
    }
    Object.assign(target, source);
  }
  onFileChanged() {
    try {
      if (!fs.existsSync(this.filePath))
        return;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
      }
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {}
      const newIds = new Set(parsed.map((j) => j.id));
      const currentIds = new Set(this.jobs.keys());
      for (const id of currentIds) {
        if (!newIds.has(id)) {
          const existing = this.jobs.get(id);
          if (existing?.currentTaskId) {
            this.taskBoard?.kill(existing.currentTaskId);
          }
          this.jobs.delete(id);
          logger2.info(`文件同步: 删除任务 ${id}`);
        }
      }
      for (const job of parsed) {
        const existing = this.jobs.get(job.id);
        if (!existing) {
          this.jobs.set(job.id, job);
          if (job.enabled)
            this.registerJobToTaskBoard(job);
          logger2.info(`文件同步: 新增任务 ${job.name} (${job.id})`);
        } else {
          const shouldReschedule = this.shouldRescheduleAfterFileSync(existing, job);
          const existingStr = JSON.stringify(existing);
          const newStr = JSON.stringify(job);
          if (existingStr !== newStr) {
            this.syncJobInPlace(existing, job);
            if (shouldReschedule) {
              if (existing.currentTaskId) {
                this.taskBoard?.kill(existing.currentTaskId);
                existing.currentTaskId = undefined;
              }
              if (existing.enabled && this.running) {
                this.registerJobToTaskBoard(existing);
              }
            }
            logger2.info(`文件同步: 更新任务 ${job.name} (${job.id})`);
          }
        }
      }
      logger2.info(`文件同步完成，当前共 ${this.jobs.size} 个任务`);
    } catch (err) {
      logger2.error(`文件同步失败: ${err}`);
    }
  }
}

// extensions/cron/src/tool.ts
function parseOnceScheduleValue(value) {
  const trimmed = value.trim();
  const relativeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (relativeMatch) {
    const amount = parseFloat(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    let ms;
    if (unit.startsWith("s")) {
      ms = amount * 1000;
    } else if (unit.startsWith("m") && !unit.startsWith("mi")) {
      ms = amount * 60 * 1000;
    } else if (unit.startsWith("mi")) {
      ms = amount * 60 * 1000;
    } else if (unit.startsWith("h")) {
      ms = amount * 3600 * 1000;
    } else if (unit.startsWith("d")) {
      ms = amount * 86400 * 1000;
    } else {
      return { error: `无法识别的时间单位: "${unit}"` };
    }
    if (ms <= 0) {
      return { error: `延迟时间必须为正数: "${trimmed}"` };
    }
    return { at: Date.now() + Math.round(ms) };
  }
  if (/^-?\d+$/.test(trimmed)) {
    const numeric = parseInt(trimmed, 10);
    if (numeric <= 0) {
      return { error: `无效的数值: "${trimmed}"，应为正数` };
    }
    if (numeric > 1577836800000) {
      return { at: numeric };
    }
    return { at: Date.now() + numeric };
  }
  const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const parsed = Date.parse(normalized);
  if (!isNaN(parsed)) {
    const now = Date.now();
    if (parsed <= now) {
      return { error: `指定的时间已经过去: "${trimmed}"` };
    }
    return { at: parsed };
  }
  return { error: `无法解析的 once 时间值: "${trimmed}"。支持的格式：相对延迟（如 "30s", "5m", "2h"）或绝对日期（如 "2026-04-03 17:30"）` };
}
var logger3 = createPluginLogger("cron", "tool");
var scheduler = null;
var currentSessionId = "default";
function injectScheduler(s2) {
  scheduler = s2;
}
function clearScheduler() {
  scheduler = null;
}
function setCurrentSessionId(sid) {
  currentSessionId = sid;
}
var manageScheduledTasksTool = {
  declaration: {
    name: "manage_scheduled_tasks",
    description: `管理定时调度任务。支持创建（create）、更新（update）、删除（delete）、启用（enable）、禁用（disable）、列出（list）和查询（get）定时任务。
` + `调度模式：
` + `- cron: cron 表达式，如 "0 9 * * 1-5"（工作日每天早上9点）
` + `- interval: 固定间隔毫秒数，如 "60000"
` + `- once: 一次性定时，支持相对延迟（如 "30s", "5m", "2h"）或绝对日期时间（如 "2026-04-03 17:30"）
` + `任务触发后会在后台独立拉起一个 agent 执行预设的 instruction 指令（拥有独立的工具调用能力）。
` + `可通过 allowed_tools（白名单）或 exclude_tools（黑名单）为每个任务单独配置可用工具集，未配置时使用全局默认策略。
` + `执行完成后的行为取决于 silent 参数：
` + `  - silent=false（默认）：执行结果作为通知注入当前会话，由主 agent 处理并回复用户。
` + `  - silent=true：仅向各前端平台广播一条轻量通知（任务名+结果摘要），不触发主 agent 处理，不占用对话。
` + "两种模式下，执行记录都会持久化保存。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "delete", "enable", "disable", "list", "get"],
          description: "操作类型：create（创建）、update（更新）、delete（删除）、enable（启用）、disable（禁用）、list（列出所有）、get（查询详情）"
        },
        name: {
          type: "string",
          description: "任务名称（create / update 时使用）"
        },
        schedule_type: {
          type: "string",
          enum: ["cron", "interval", "once"],
          description: "调度类型：cron（cron 表达式）、interval（固定间隔毫秒）、once（一次性定时）"
        },
        schedule_value: {
          type: "string",
          description: `调度参数值，根据 schedule_type 不同而不同：
` + `- cron: cron 表达式，如 "0 9 * * 1-5"
` + `- interval: 间隔毫秒数，如 "60000"
` + '- once: 相对延迟如 "30s"、"5m"、"2h"、"1d"，或绝对日期时间如 "2026-04-03 17:30"'
        },
        instruction: {
          type: "string",
          description: "任务触发时执行的指令文本"
        },
        job_id: {
          type: "string",
          description: "任务 ID（update / delete / enable / disable / get 时使用）"
        },
        silent: {
          type: "boolean",
          description: "是否静默执行（不触发主会话回复，仅发通知）"
        },
        urgent: {
          type: "boolean",
          description: "是否为紧急任务（可穿透安静时段）"
        },
        condition: {
          type: "string",
          description: `条件表达式（可选）。JS 语法，触发时求值，truthy 才执行。
` + `可用变量（从 GlobalStore 自动读取）：
` + `  agent.xxx — agent 作用域（跨对话持久）
` + `  global.xxx — 全局变量
` + `  session.xxx — 当前会话变量
` + `内置函数：
` + `  random() — 0-1 随机数
` + `  now() — 时间戳(ms)  hour() — 当前小时  day() — 星期
` + `示例：
` + `  "agent.好感度 > 80 && random() < 0.5"
` + `  "agent.信任度 >= 60 || agent.好感度 >= 90"
` + '  "hour() >= 9 && hour() <= 22"'
        },
        allowed_tools: {
          type: "array",
          items: { type: "string" },
          description: `允许使用的工具列表（白名单模式）。设置后任务只能使用这些工具。
` + `与 exclude_tools 互斥，同时提供时 allowed_tools 优先。
` + `不设置则使用全局 backgroundExecution.excludeTools 配置。
` + '示例：["read_file", "write_file", "shell"]'
        },
        exclude_tools: {
          type: "array",
          items: { type: "string" },
          description: `排除的工具列表（黑名单模式）。设置后任务不能使用这些工具。
` + `与 allowed_tools 互斥，同时提供时 allowed_tools 优先。
` + `不设置则使用全局 backgroundExecution.excludeTools 配置。
` + `设置为空数组 [] 可清除任务级别配置，回退到全局默认。
` + '示例：["sub_agent", "manage_scheduled_tasks"]'
        }
      },
      required: ["action"]
    }
  },
  parallel: false,
  handler: async (args) => {
    if (!scheduler) {
      return { error: "调度器尚未初始化，请稍后重试" };
    }
    const action = args.action;
    switch (action) {
      case "create": {
        const name = args.name;
        const scheduleType = args.schedule_type;
        const scheduleValue = args.schedule_value;
        const instruction = args.instruction;
        if (!name || !scheduleType || !scheduleValue || !instruction) {
          return {
            error: "create 操作需要以下参数：name, schedule_type, schedule_value, instruction"
          };
        }
        let schedule;
        switch (scheduleType) {
          case "cron":
            schedule = { type: "cron", expression: scheduleValue };
            break;
          case "interval": {
            const ms = parseInt(scheduleValue, 10);
            if (isNaN(ms) || ms <= 0) {
              return { error: `无效的间隔值: "${scheduleValue}"，应为正整数毫秒数` };
            }
            schedule = { type: "interval", ms };
            break;
          }
          case "once": {
            const result = parseOnceScheduleValue(scheduleValue);
            if ("error" in result) {
              return { error: result.error };
            }
            schedule = { type: "once", at: result.at };
            break;
          }
          default:
            return { error: `不支持的调度类型: "${scheduleType}"` };
        }
        const params = {
          name,
          schedule,
          sessionId: currentSessionId,
          instruction,
          delivery: {
            sessionId: currentSessionId,
            fallback: "last-active"
          },
          silent: args.silent ?? false,
          urgent: args.urgent ?? false,
          condition: args.condition,
          allowedTools: Array.isArray(args.allowed_tools) ? args.allowed_tools : undefined,
          excludeTools: Array.isArray(args.exclude_tools) ? args.exclude_tools : undefined,
          createdInSession: currentSessionId
        };
        const job = scheduler.createJob(params);
        logger3.info(`工具调用: 创建任务 "${job.name}" (${job.id})`);
        return {
          success: true,
          job: {
            id: job.id,
            name: job.name,
            schedule: job.schedule,
            instruction: job.instruction,
            silent: job.silent,
            urgent: job.urgent,
            condition: job.condition,
            allowedTools: job.allowedTools,
            excludeTools: job.excludeTools,
            enabled: job.enabled,
            createdAt: new Date(job.createdAt).toISOString()
          }
        };
      }
      case "update": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "update 操作需要 job_id 参数" };
        }
        const updateParams = {};
        if (args.name !== undefined)
          updateParams.name = args.name;
        if (args.instruction !== undefined)
          updateParams.instruction = args.instruction;
        if (args.silent !== undefined)
          updateParams.silent = args.silent;
        if (args.urgent !== undefined)
          updateParams.urgent = args.urgent;
        if (args.condition !== undefined)
          updateParams.condition = args.condition;
        if (args.allowed_tools !== undefined) {
          updateParams.allowedTools = Array.isArray(args.allowed_tools) && args.allowed_tools.length > 0 ? args.allowed_tools : [];
        }
        if (args.exclude_tools !== undefined) {
          updateParams.excludeTools = Array.isArray(args.exclude_tools) && args.exclude_tools.length > 0 ? args.exclude_tools : [];
        }
        if (args.schedule_type && args.schedule_value) {
          const st = args.schedule_type;
          const sv = args.schedule_value;
          switch (st) {
            case "cron":
              updateParams.schedule = { type: "cron", expression: sv };
              break;
            case "interval":
              updateParams.schedule = { type: "interval", ms: parseInt(sv, 10) };
              break;
            case "once": {
              const result = parseOnceScheduleValue(sv);
              if ("error" in result) {
                return { error: result.error };
              }
              updateParams.schedule = { type: "once", at: result.at };
              break;
            }
          }
        }
        const updated = scheduler.updateJob(jobId, updateParams);
        if (!updated) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger3.info(`工具调用: 更新任务 "${updated.name}" (${jobId})`);
        return { success: true, job: updated };
      }
      case "delete": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "delete 操作需要 job_id 参数" };
        }
        const deleted = scheduler.deleteJob(jobId);
        if (!deleted) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger3.info(`工具调用: 删除任务 ${jobId}`);
        return { success: true, message: `任务 ${jobId} 已删除` };
      }
      case "enable": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "enable 操作需要 job_id 参数" };
        }
        const enabled = scheduler.enableJob(jobId);
        if (!enabled) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger3.info(`工具调用: 启用任务 "${enabled.name}" (${jobId})`);
        return { success: true, job: enabled };
      }
      case "disable": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "disable 操作需要 job_id 参数" };
        }
        const disabled = scheduler.disableJob(jobId);
        if (!disabled) {
          return { error: `未找到任务: ${jobId}` };
        }
        logger3.info(`工具调用: 禁用任务 "${disabled.name}" (${jobId})`);
        return { success: true, job: disabled };
      }
      case "list": {
        const jobs = scheduler.listJobs();
        return {
          success: true,
          count: jobs.length,
          jobs: jobs.map((j) => ({
            id: j.id,
            name: j.name,
            schedule: j.schedule,
            enabled: j.enabled,
            silent: j.silent,
            urgent: j.urgent,
            allowedTools: j.allowedTools ?? null,
            excludeTools: j.excludeTools ?? null,
            lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toISOString() : null,
            lastRunStatus: j.lastRunStatus ?? null
          }))
        };
      }
      case "get": {
        const jobId = args.job_id;
        if (!jobId) {
          return { error: "get 操作需要 job_id 参数" };
        }
        const job = scheduler.getJob(jobId);
        if (!job) {
          return { error: `未找到任务: ${jobId}` };
        }
        return { success: true, job };
      }
      default:
        return { error: `不支持的操作类型: "${action}"` };
    }
  }
};

// extensions/cron/src/config-template.ts
function buildDefaultConfigTemplate() {
  const promptYaml = DEFAULT_CRON_SYSTEM_PROMPT.split(`
`).map((line) => `    ${line}`).join(`
`);
  return `# ============================================================
# 定时任务调度插件配置
# ============================================================
#
# 启用后，LLM 可通过 manage_scheduled_tasks 工具
# 创建、管理定时任务，实现自动化调度。
#
# 修改后保存即可生效，无需重启。

# 是否启用调度器
enabled: true

# ────────────────────────────────────────
# 后台执行配置
# ────────────────────────────────────────
# 定时任务触发后会在后台独立拉起一个 agent 执行指令，
# 以下参数控制这个后台执行环境的行为。
backgroundExecution:

  # 定时任务执行时的系统提示词
  # 定义后台 agent 的角色和行为准则
  systemPrompt: |
${promptYaml}

  # 全局排除的工具列表（黑名单）
  # 这些工具在定时任务后台执行时默认不可用。
  # 默认排除：
  #   - sub_agent: 没有父会话上下文，子代理无意义
  #   - history_search: 需要 sessionId，定时任务没有活跃会话
  #   - manage_scheduled_tasks: 防止后台 agent 自行修改/删除定时任务
  # 设置为空数组 [] 可开放所有工具。
  #
  # 注意：可在创建任务时通过 allowed_tools（白名单）或 exclude_tools（黑名单）
  # 为每个任务单独配置工具策略，任务级别配置优先于此全局配置。
  excludeTools:
    - sub_agent
    - history_search
    - manage_scheduled_tasks

  # 工具循环最大轮次
  # 单次定时任务执行中 LLM 最多可进行的工具调用轮次。
  # 超过此轮次后强制结束并返回当前结果。
  maxToolRounds: 50

  # 单次执行超时时间（毫秒），超时后任务被中止
  # 默认 5 分钟 = 300000
  timeoutMs: 300000

  # 同时运行的最大后台任务数
  # 超过此数量的任务会被跳过（标记为 skipped）
  maxConcurrent: 3

  # 执行记录保留天数
  retentionDays: 30

  # 执行记录保留条数上限
  retentionCount: 100

# ────────────────────────────────────────
# 安静时段配置
# ────────────────────────────────────────
# 在安静时段内，非紧急任务将被跳过
quietHours:
  enabled: false
  windows:
    - start: "23:00"
      end: "07:00"
  # 是否允许紧急任务穿透安静时段
  allowUrgent: true

# ────────────────────────────────────────
# 跳过近期活跃会话
# ────────────────────────────────────────
# 如果目标会话在指定分钟内有过活动，则跳过本次投递
skipIfRecentActivity:
  enabled: false
  withinMinutes: 5
`;
}

// extensions/cron/src/service.ts
function toSchedulerJob(job) {
  return {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    sessionId: job.sessionId,
    instruction: job.instruction,
    delivery: job.delivery,
    silent: job.silent,
    urgent: job.urgent,
    condition: job.condition,
    allowedTools: job.allowedTools,
    excludeTools: job.excludeTools,
    enabled: job.enabled,
    createdAt: job.createdAt,
    createdInSession: job.createdInSession,
    lastRunAt: job.lastRunAt,
    lastRunStatus: job.lastRunStatus,
    lastRunError: job.lastRunError
  };
}
function resolveSessionId(api, input) {
  return input.sessionId ?? input.delivery?.sessionId ?? api.agentManager?.getActiveSessionId?.() ?? "scheduler-service";
}
function applyFilter(jobs, filter) {
  if (!filter)
    return jobs;
  return jobs.filter((job) => {
    if (filter.enabled !== undefined && job.enabled !== filter.enabled)
      return false;
    if (filter.nameIncludes && !job.name.includes(filter.nameIncludes))
      return false;
    return true;
  });
}
function createCronSchedulerService(scheduler2, api) {
  return {
    createJob(input) {
      const sessionId = resolveSessionId(api, input);
      const job = scheduler2.createJob({
        name: input.name,
        schedule: input.schedule,
        sessionId,
        instruction: input.instruction,
        delivery: {
          fallback: input.delivery?.fallback ?? "last-active",
          sessionId: input.delivery?.sessionId ?? sessionId
        },
        silent: input.silent,
        urgent: input.urgent,
        condition: input.condition,
        allowedTools: input.allowedTools,
        excludeTools: input.excludeTools,
        createdInSession: input.createdInSession ?? sessionId
      });
      return toSchedulerJob(job);
    },
    updateJob(id, input) {
      const job = scheduler2.updateJob(id, input);
      return job ? toSchedulerJob(job) : undefined;
    },
    deleteJob(id) {
      return scheduler2.deleteJob(id);
    },
    enableJob(id) {
      const job = scheduler2.enableJob(id);
      return job ? toSchedulerJob(job) : undefined;
    },
    disableJob(id) {
      const job = scheduler2.disableJob(id);
      return job ? toSchedulerJob(job) : undefined;
    },
    getJob(id) {
      const job = scheduler2.getJob(id);
      return job ? toSchedulerJob(job) : undefined;
    },
    listJobs(filter) {
      return applyFilter(scheduler2.listJobs().map(toSchedulerJob), filter);
    }
  };
}

// extensions/cron/src/index.ts
var logger4 = createPluginLogger("cron");
var schedulerInstance = null;
var schedulerServiceDisposable;
var lifecycleDisposables = [];
var backendWithDoneListener;
var backendDoneListener;
function trackDisposable(disposable) {
  if (disposable)
    lifecycleDisposables.push(disposable);
}
function disposeLifecycleDisposables() {
  for (const disposable of lifecycleDisposables.splice(0, lifecycleDisposables.length).reverse()) {
    try {
      disposable.dispose();
    } catch {}
  }
}
function disposeBackendDoneListener() {
  if (!backendWithDoneListener || !backendDoneListener)
    return;
  try {
    backendWithDoneListener.off?.("done", backendDoneListener);
    backendWithDoneListener.removeListener?.("done", backendDoneListener);
  } catch {}
  backendWithDoneListener = undefined;
  backendDoneListener = undefined;
}
var src_default = definePlugin({
  name: "cron",
  version: "0.1.0",
  description: "定时任务调度插件 — Cron / Interval / Once 三种调度模式",
  activate(ctx) {
    ctx.ensureConfigFile?.("cron.yaml", buildDefaultConfigTemplate());
    const rawSection = ctx.readConfigSection?.("cron");
    const mergedRaw = rawSection ?? {};
    const config = resolveConfig(mergedRaw);
    const bgConfig = resolveBackgroundConfig(mergedRaw?.backgroundExecution);
    if (!config.enabled) {
      logger4.info("调度器未启用（config.enabled = false）");
      return;
    }
    ctx.registerTool(manageScheduledTasksTool);
    logger4.info("manage_scheduled_tasks 工具已注册");
    ctx.addHook({
      name: "cron:capture-session",
      priority: 200,
      onBeforeChat({ sessionId }) {
        setCurrentSessionId(sessionId);
        return;
      }
    });
    ctx.onReady(async (api) => {
      const cronDataDir = ctx.getDataDir();
      const taskBoard = api.taskBoard ?? null;
      const agentName = api.agentName ?? "master";
      schedulerInstance = new CronScheduler(api, config, taskBoard, agentName, bgConfig, cronDataDir);
      injectScheduler(schedulerInstance);
      schedulerServiceDisposable?.dispose();
      schedulerServiceDisposable = api.services.register(SCHEDULER_SERVICE_ID, createCronSchedulerService(schedulerInstance, api), {
        description: "Generic scheduler service backed by the cron extension",
        version: "1.0.0"
      });
      logger4.info(`Scheduler service 已注册: ${SCHEDULER_SERVICE_ID}`);
      disposeBackendDoneListener();
      backendDoneListener = (sessionId) => {
        schedulerInstance?.recordActivity(sessionId);
      };
      backendWithDoneListener = api.backend;
      api.backend.on("done", backendDoneListener);
      await schedulerInstance.start();
      for (const disposable of registerWebRoutes(api))
        trackDisposable(disposable);
      trackDisposable(registerSettingsTab(api, ctx));
      logger4.info("调度器插件初始化完成");
    });
  },
  async deactivate() {
    disposeLifecycleDisposables();
    disposeBackendDoneListener();
    schedulerServiceDisposable?.dispose();
    schedulerServiceDisposable = undefined;
    if (schedulerInstance) {
      schedulerInstance.stop();
      schedulerInstance = null;
    }
    clearScheduler();
    logger4.info("调度器插件已卸载");
  }
});
function registerWebRoutes(api) {
  if (!api.registerWebRoute) {
    logger4.info("Web 路由注册不可用（非 Web 平台），跳过");
    return [];
  }
  const disposables = [];
  disposables.push(api.registerWebRoute("GET", "/api/plugins/cron/jobs", async (_req, res) => {
    const jobs = schedulerInstance?.listJobs() ?? [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, jobs }));
  }));
  disposables.push(api.registerWebRoute("POST", "/api/plugins/cron/jobs/:id/toggle", async (_req, res, params) => {
    if (!schedulerInstance) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "调度器未初始化" }));
      return;
    }
    const job = schedulerInstance.getJob(params.id);
    if (!job) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "任务不存在" }));
      return;
    }
    const result = job.enabled ? schedulerInstance.disableJob(params.id) : schedulerInstance.enableJob(params.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, job: result }));
  }));
  disposables.push(api.registerWebRoute("DELETE", "/api/plugins/cron/jobs/:id", async (_req, res, params) => {
    if (!schedulerInstance) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "调度器未初始化" }));
      return;
    }
    const deleted = schedulerInstance.deleteJob(params.id);
    if (!deleted) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "任务不存在" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  }));
  disposables.push(api.registerWebRoute("GET", "/api/plugins/cron/runs", async (_req, res) => {
    const runs = schedulerInstance?.listRuns() ?? [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, runs }));
  }));
  disposables.push(api.registerWebRoute("GET", "/api/plugins/cron/runs/:runId", async (_req, res, params) => {
    if (!schedulerInstance) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "调度器未初始化" }));
      return;
    }
    const record = schedulerInstance.getRunRecord(params.runId);
    if (!record) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "执行记录不存在" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, record }));
  }));
  logger4.info("Web API 路由已注册（5 个端点）");
  return disposables;
}
function registerSettingsTab(api, ctx) {
  const registerTab = api.registerConsoleSettingsTab;
  if (!registerTab) {
    logger4.info("Console Settings Tab 注册不可用，跳过");
    return;
  }
  const disposable = registerTab({
    id: "cron",
    label: "定时任务",
    icon: "06",
    fields: [
      {
        key: "enabled",
        label: "启用调度器",
        type: "toggle",
        defaultValue: true,
        description: "是否启用定时任务调度功能"
      },
      {
        key: "quietHoursEnabled",
        label: "启用安静时段",
        type: "toggle",
        defaultValue: false,
        description: "在安静时段内，非紧急任务将被跳过",
        group: "安静时段"
      },
      {
        key: "quietHoursStart",
        label: "开始时间",
        type: "text",
        defaultValue: "23:00",
        description: "安静时段开始时间（HH:MM 格式）",
        group: "安静时段"
      },
      {
        key: "quietHoursEnd",
        label: "结束时间",
        type: "text",
        defaultValue: "07:00",
        description: "安静时段结束时间（HH:MM 格式）",
        group: "安静时段"
      },
      {
        key: "quietHoursAllowUrgent",
        label: "允许紧急任务穿透",
        type: "toggle",
        defaultValue: true,
        description: "紧急任务是否可以在安静时段内执行",
        group: "安静时段"
      },
      {
        key: "skipRecentEnabled",
        label: "跳过近期活跃会话",
        type: "toggle",
        defaultValue: true,
        description: "如果目标会话近期有活动则跳过本次投递",
        group: "跳过近期活跃"
      },
      {
        key: "skipRecentMinutes",
        label: "活跃窗口（分钟）",
        type: "number",
        defaultValue: 5,
        description: "多少分钟内有活动视为近期活跃",
        group: "跳过近期活跃"
      },
      {
        key: "jobsSummary",
        label: "当前任务",
        type: "readonly",
        description: "已注册的定时任务概览",
        group: "当前任务"
      }
    ],
    onLoad: async () => {
      const cfg = schedulerInstance?.getConfig() ?? DEFAULT_SCHEDULER_CONFIG;
      const jobs = schedulerInstance?.listJobs() ?? [];
      const jobsSummary = jobs.length === 0 ? "暂无任务" : jobs.map((j) => `${j.enabled ? "✓" : "✗"} ${j.name} (${j.schedule.type})`).join(`
`);
      return {
        enabled: cfg.enabled,
        quietHoursEnabled: cfg.quietHours.enabled,
        quietHoursStart: cfg.quietHours.windows[0]?.start ?? "23:00",
        quietHoursEnd: cfg.quietHours.windows[0]?.end ?? "07:00",
        quietHoursAllowUrgent: cfg.quietHours.allowUrgent,
        skipRecentEnabled: cfg.skipIfRecentActivity.enabled,
        skipRecentMinutes: cfg.skipIfRecentActivity.withinMinutes,
        jobsSummary
      };
    },
    onSave: async (values) => {
      try {
        const newConfig = {
          enabled: values.enabled,
          quietHours: {
            enabled: values.quietHoursEnabled,
            windows: [
              {
                start: values.quietHoursStart,
                end: values.quietHoursEnd
              }
            ],
            allowUrgent: values.quietHoursAllowUrgent
          },
          skipIfRecentActivity: {
            enabled: values.skipRecentEnabled,
            withinMinutes: values.skipRecentMinutes
          }
        };
        schedulerInstance?.updateConfig(newConfig);
        return { success: true, message: "配置已生效（如需持久化请编辑 cron.yaml）" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger4.error(`保存配置失败: ${msg}`);
        return { success: false, error: msg };
      }
    }
  });
  logger4.info("Console Settings Tab 已注册");
  return disposable;
}
function resolveConfig(raw) {
  const quietHours = raw?.quietHours;
  const skipRecent = raw?.skipIfRecentActivity;
  return {
    enabled: raw?.enabled ?? DEFAULT_SCHEDULER_CONFIG.enabled,
    quietHours: {
      ...DEFAULT_SCHEDULER_CONFIG.quietHours,
      ...quietHours ? {
        enabled: quietHours.enabled ?? DEFAULT_SCHEDULER_CONFIG.quietHours.enabled,
        allowUrgent: quietHours.allowUrgent ?? DEFAULT_SCHEDULER_CONFIG.quietHours.allowUrgent,
        ...quietHours.windows ? { windows: quietHours.windows } : {}
      } : {}
    },
    skipIfRecentActivity: {
      ...DEFAULT_SCHEDULER_CONFIG.skipIfRecentActivity,
      ...skipRecent ? {
        enabled: skipRecent.enabled ?? DEFAULT_SCHEDULER_CONFIG.skipIfRecentActivity.enabled,
        withinMinutes: skipRecent.withinMinutes ?? DEFAULT_SCHEDULER_CONFIG.skipIfRecentActivity.withinMinutes
      } : {}
    }
  };
}
function resolveBackgroundConfig(raw) {
  if (!raw)
    return { ...DEFAULT_BACKGROUND_CONFIG };
  return {
    systemPrompt: typeof raw.systemPrompt === "string" && raw.systemPrompt.trim() ? raw.systemPrompt.trim() : DEFAULT_BACKGROUND_CONFIG.systemPrompt,
    excludeTools: Array.isArray(raw.excludeTools) ? raw.excludeTools.filter((t) => typeof t === "string") : [...DEFAULT_BACKGROUND_CONFIG.excludeTools],
    maxToolRounds: typeof raw.maxToolRounds === "number" && raw.maxToolRounds > 0 ? raw.maxToolRounds : DEFAULT_BACKGROUND_CONFIG.maxToolRounds,
    timeoutMs: typeof raw.timeoutMs === "number" && raw.timeoutMs > 0 ? raw.timeoutMs : DEFAULT_BACKGROUND_CONFIG.timeoutMs,
    maxConcurrent: typeof raw.maxConcurrent === "number" && raw.maxConcurrent > 0 ? raw.maxConcurrent : DEFAULT_BACKGROUND_CONFIG.maxConcurrent,
    retentionDays: typeof raw.retentionDays === "number" && raw.retentionDays > 0 ? raw.retentionDays : DEFAULT_BACKGROUND_CONFIG.retentionDays,
    retentionCount: typeof raw.retentionCount === "number" && raw.retentionCount > 0 ? raw.retentionCount : DEFAULT_BACKGROUND_CONFIG.retentionCount
  };
}
export {
  src_default as default
};
