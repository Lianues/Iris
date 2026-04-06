import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/silk-wasm/lib/index.cjs
var require_lib = __commonJS((exports, module) => {
  var __filename = "C:\\Users\\Moeblack\\Repos\\Iris\\extensions\\weixin\\node_modules\\silk-wasm\\lib\\index.cjs";
  var __defProp2 = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames2 = Object.getOwnPropertyNames;
  var __hasOwnProp2 = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp2(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from == "object" || typeof from == "function")
      for (let key of __getOwnPropNames2(from))
        !__hasOwnProp2.call(to, key) && key !== except && __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp2({}, "__esModule", { value: true }), mod);
  var index_exports = {};
  __export(index_exports, { decode: () => decode, encode: () => encode, getDuration: () => getDuration, getWavFileInfo: () => getWavFileInfo2, isSilk: () => isSilk, isWav: () => isWav });
  module.exports = __toCommonJS(index_exports);
  var import_meta_url = __require("url").pathToFileURL(__filename).href;
  var Module = async function(moduleArg = {}) {
    var moduleRtn, g = moduleArg, aa, q, ba = new Promise((a, b) => {
      aa = a, q = b;
    }), ca = typeof window == "object", da = typeof WorkerGlobalScope < "u", t = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type != "renderer";
    if (t) {
      let { createRequire: a } = await import("module");
      var require2 = a(import_meta_url);
    }
    var u = (a, b) => {
      throw b;
    }, ea = import_meta_url, v = "", fa, w;
    if (t) {
      var fs = require2("fs"), ha = require2("path");
      ea.startsWith("file:") && (v = ha.dirname(require2("url").fileURLToPath(ea)) + "/"), w = (a) => (a = y(a) ? new URL(a) : a, fs.readFileSync(a)), fa = async (a) => (a = y(a) ? new URL(a) : a, fs.readFileSync(a, undefined)), process.argv.slice(2), u = (a, b) => {
        throw process.exitCode = a, b;
      };
    } else if (ca || da) {
      try {
        v = new URL(".", ea).href;
      } catch {}
      da && (w = (a) => {
        var b = new XMLHttpRequest;
        return b.open("GET", a, false), b.responseType = "arraybuffer", b.send(null), new Uint8Array(b.response);
      }), fa = async (a) => {
        if (y(a))
          return new Promise((d, c) => {
            var e = new XMLHttpRequest;
            e.open("GET", a, true), e.responseType = "arraybuffer", e.onload = () => {
              e.status == 200 || e.status == 0 && e.response ? d(e.response) : c(e.status);
            }, e.onerror = c, e.send(null);
          });
        var b = await fetch(a, { credentials: "same-origin" });
        if (b.ok)
          return b.arrayBuffer();
        throw Error(b.status + " : " + b.url);
      };
    }
    console.log.bind(console);
    var A = console.error.bind(console), C, D, E = false, ia, ja, F, G, H, I, J, ka, la, ma, na, y = (a) => a.startsWith("file://");
    function pa() {
      var a = D.buffer;
      ja = new Int8Array(a), G = new Int16Array(a), F = new Uint8Array(a), H = new Uint16Array(a), I = new Int32Array(a), J = new Uint32Array(a), ka = new Float32Array(a), na = new Float64Array(a), la = new BigInt64Array(a), ma = new BigUint64Array(a);
    }
    var K = 0, L = null;
    function qa(a) {
      throw g.onAbort?.(a), a = "Aborted(" + a + ")", A(a), E = true, a = new WebAssembly.RuntimeError(a + ". Build with -sASSERTIONS for more info."), q(a), a;
    }
    var ra;
    async function sa(a) {
      if (!C)
        try {
          var b = await fa(a);
          return new Uint8Array(b);
        } catch {}
      if (a == ra && C)
        a = new Uint8Array(C);
      else if (w)
        a = w(a);
      else
        throw "both async and sync fetching of the wasm failed";
      return a;
    }
    async function ta(a, b) {
      try {
        var d = await sa(a);
        return await WebAssembly.instantiate(d, b);
      } catch (c) {
        A(`failed to asynchronously prepare wasm: ${c}`), qa(c);
      }
    }
    async function ua(a) {
      var b = ra;
      if (!C && typeof WebAssembly.instantiateStreaming == "function" && !y(b) && !t)
        try {
          var d = fetch(b, { credentials: "same-origin" });
          return await WebAssembly.instantiateStreaming(d, a);
        } catch (c) {
          A(`wasm streaming compile failed: ${c}`), A("falling back to ArrayBuffer instantiation");
        }
      return ta(b, a);
    }

    class va {
      name = "ExitStatus";
      constructor(a) {
        this.message = `Program terminated with exit(${a})`, this.status = a;
      }
    }
    var wa = (a) => {
      for (;0 < a.length; )
        a.shift()(g);
    }, xa = [], ya = [], za = () => {
      var a = g.preRun.shift();
      ya.push(a);
    }, O = true;

    class Aa {
      constructor(a) {
        this.I = a - 24;
      }
    }
    var Ba = 0, Ca = 0, Da, P = (a) => {
      for (var b = "";F[a]; )
        b += Da[F[a++]];
      return b;
    }, Q = {}, R = {}, S = {}, T = g.BindingError = class extends Error {
      constructor(a) {
        super(a), this.name = "BindingError";
      }
    }, Ea = (a) => {
      throw new T(a);
    };
    function Fa(a, b, d = {}) {
      var c = b.name;
      if (!a)
        throw new T(`type "${c}" must have a positive integer typeid pointer`);
      if (R.hasOwnProperty(a)) {
        if (d.K)
          return;
        throw new T(`Cannot register type '${c}' twice`);
      }
      R[a] = b, delete S[a], Q.hasOwnProperty(a) && (b = Q[a], delete Q[a], b.forEach((e) => e()));
    }
    function U(a, b, d = {}) {
      return Fa(a, b, d);
    }
    var Ga = (a, b, d) => {
      switch (b) {
        case 1:
          return d ? (c) => ja[c] : (c) => F[c];
        case 2:
          return d ? (c) => G[c >> 1] : (c) => H[c >> 1];
        case 4:
          return d ? (c) => I[c >> 2] : (c) => J[c >> 2];
        case 8:
          return d ? (c) => la[c >> 3] : (c) => ma[c >> 3];
        default:
          throw new TypeError(`invalid integer width (${b}): ${a}`);
      }
    }, Ha = [], V = [], Ia = (a) => {
      9 < a && --V[a + 1] === 0 && (V[a] = undefined, Ha.push(a));
    }, Ja = (a) => {
      if (!a)
        throw new T(`Cannot use deleted val. handle = ${a}`);
      return V[a];
    }, Ka = (a) => {
      switch (a) {
        case undefined:
          return 2;
        case null:
          return 4;
        case true:
          return 6;
        case false:
          return 8;
        default:
          let b = Ha.pop() || V.length;
          return V[b] = a, V[b + 1] = 1, b;
      }
    };
    function La(a) {
      return this.fromWireType(J[a >> 2]);
    }
    var Ma = { name: "emscripten::val", fromWireType: (a) => {
      var b = Ja(a);
      return Ia(a), b;
    }, toWireType: (a, b) => Ka(b), H: 8, readValueFromPointer: La, G: null }, Na = (a, b) => {
      switch (b) {
        case 4:
          return function(d) {
            return this.fromWireType(ka[d >> 2]);
          };
        case 8:
          return function(d) {
            return this.fromWireType(na[d >> 3]);
          };
        default:
          throw new TypeError(`invalid float width (${b}): ${a}`);
      }
    }, Oa = (a) => {
      for (;a.length; ) {
        var b = a.pop();
        a.pop()(b);
      }
    };
    function Pa(a) {
      for (var b = 1;b < a.length; ++b)
        if (a[b] !== null && a[b].G === undefined)
          return true;
      return false;
    }
    var Sa = (a, b) => {
      if (g[a].F === undefined) {
        var d = g[a];
        g[a] = function(...c) {
          if (!g[a].F.hasOwnProperty(c.length))
            throw new T(`Function '${b}' called with an invalid number of arguments (${c.length}) - expects one of (${g[a].F})!`);
          return g[a].F[c.length].apply(this, c);
        }, g[a].F = [], g[a].F[d.J] = d;
      }
    }, Ta = (a, b, d) => {
      if (g.hasOwnProperty(a)) {
        if (d === undefined || g[a].F !== undefined && g[a].F[d] !== undefined)
          throw new T(`Cannot register public name '${a}' twice`);
        if (Sa(a, a), g[a].F.hasOwnProperty(d))
          throw new T(`Cannot register multiple overloads of a function with the same number of arguments (${d})!`);
        g[a].F[d] = b;
      } else
        g[a] = b, g[a].J = d;
    }, Ua = (a, b) => {
      for (var d = [], c = 0;c < a; c++)
        d.push(J[b + 4 * c >> 2]);
      return d;
    }, Va = g.InternalError = class extends Error {
      constructor(a) {
        super(a), this.name = "InternalError";
      }
    }, Wa = [], Xa, Ya = (a, b) => {
      a = P(a);
      var d;
      if ((d = Wa[b]) || (Wa[b] = d = Xa.get(b)), typeof d != "function")
        throw new T(`unknown function pointer with signature ${a}: ${b}`);
      return d;
    };

    class Za extends Error {
    }
    for (var ab = (a) => {
      a = $a(a);
      var b = P(a);
      return W(a), b;
    }, bb = (a, b) => {
      function d(f) {
        e[f] || R[f] || (S[f] ? S[f].forEach(d) : (c.push(f), e[f] = true));
      }
      var c = [], e = {};
      throw b.forEach(d), new Za(`${a}: ` + c.map(ab).join([", "]));
    }, cb = (a, b) => {
      function d(h) {
        if (h = b(h), h.length !== c.length)
          throw new Va("Mismatched type converter count");
        for (var l = 0;l < c.length; ++l)
          U(c[l], h[l]);
      }
      var c = [];
      c.forEach((h) => S[h] = a);
      var e = Array(a.length), f = [], m = 0;
      a.forEach((h, l) => {
        R.hasOwnProperty(h) ? e[l] = R[h] : (f.push(h), Q.hasOwnProperty(h) || (Q[h] = []), Q[h].push(() => {
          e[l] = R[h], ++m, m === f.length && d(e);
        }));
      }), f.length === 0 && d(e);
    }, db = (a) => {
      a = a.trim();
      let b = a.indexOf("(");
      return b === -1 ? a : a.slice(0, b);
    }, eb = typeof TextDecoder < "u" ? new TextDecoder : undefined, fb = (a = 0, b = NaN) => {
      var d = F, c = a + b;
      for (b = a;d[b] && !(b >= c); )
        ++b;
      if (16 < b - a && d.buffer && eb)
        return eb.decode(d.subarray(a, b));
      for (c = "";a < b; ) {
        var e = d[a++];
        if (e & 128) {
          var f = d[a++] & 63;
          if ((e & 224) == 192)
            c += String.fromCharCode((e & 31) << 6 | f);
          else {
            var m = d[a++] & 63;
            e = (e & 240) == 224 ? (e & 15) << 12 | f << 6 | m : (e & 7) << 18 | f << 12 | m << 6 | d[a++] & 63, 65536 > e ? c += String.fromCharCode(e) : (e -= 65536, c += String.fromCharCode(55296 | e >> 10, 56320 | e & 1023));
          }
        } else
          c += String.fromCharCode(e);
      }
      return c;
    }, gb = typeof TextDecoder < "u" ? new TextDecoder("utf-16le") : undefined, hb = (a, b) => {
      for (var d = a >> 1, c = d + b / 2;!(d >= c) && H[d]; )
        ++d;
      if (d <<= 1, 32 < d - a && gb)
        return gb.decode(F.subarray(a, d));
      for (d = "", c = 0;!(c >= b / 2); ++c) {
        var e = G[a + 2 * c >> 1];
        if (e == 0)
          break;
        d += String.fromCharCode(e);
      }
      return d;
    }, ib = (a, b, d) => {
      if (d ??= 2147483647, 2 > d)
        return 0;
      d -= 2;
      var c = b;
      d = d < 2 * a.length ? d / 2 : a.length;
      for (var e = 0;e < d; ++e)
        G[b >> 1] = a.charCodeAt(e), b += 2;
      return G[b >> 1] = 0, b - c;
    }, jb = (a) => 2 * a.length, kb = (a, b) => {
      for (var d = 0, c = "";!(d >= b / 4); ) {
        var e = I[a + 4 * d >> 2];
        if (e == 0)
          break;
        ++d, 65536 <= e ? (e -= 65536, c += String.fromCharCode(55296 | e >> 10, 56320 | e & 1023)) : c += String.fromCharCode(e);
      }
      return c;
    }, lb = (a, b, d) => {
      if (d ??= 2147483647, 4 > d)
        return 0;
      var c = b;
      d = c + d - 4;
      for (var e = 0;e < a.length; ++e) {
        var f = a.charCodeAt(e);
        if (55296 <= f && 57343 >= f) {
          var m = a.charCodeAt(++e);
          f = 65536 + ((f & 1023) << 10) | m & 1023;
        }
        if (I[b >> 2] = f, b += 4, b + 4 > d)
          break;
      }
      return I[b >> 2] = 0, b - c;
    }, mb = (a) => {
      for (var b = 0, d = 0;d < a.length; ++d) {
        var c = a.charCodeAt(d);
        55296 <= c && 57343 >= c && ++d, b += 4;
      }
      return b;
    }, nb = 0, ob = [], pb = (a) => {
      var b = ob.length;
      return ob.push(a), b;
    }, qb = (a, b) => {
      var d = R[a];
      if (d === undefined)
        throw a = `${b} has unknown type ${ab(a)}`, new T(a);
      return d;
    }, rb = (a, b) => {
      for (var d = Array(a), c = 0;c < a; ++c)
        d[c] = qb(J[b + 4 * c >> 2], `parameter ${c}`);
      return d;
    }, sb = (a, b, d) => {
      var c = [];
      return a = a.toWireType(c, d), c.length && (J[b >> 2] = Ka(c)), a;
    }, X = {}, tb = (a) => {
      ia = a, O || 0 < nb || (g.onExit?.(a), E = true), u(a, new va(a));
    }, ub = (a) => {
      if (!E)
        try {
          if (a(), !(O || 0 < nb))
            try {
              ia = a = ia, tb(a);
            } catch (b) {
              b instanceof va || b == "unwind" || u(1, b);
            }
        } catch (b) {
          b instanceof va || b == "unwind" || u(1, b);
        }
    }, vb = Array(256), Y = 0;256 > Y; ++Y)
      vb[Y] = String.fromCharCode(Y);
    Da = vb, V.push(0, 1, undefined, 1, null, 1, true, 1, false, 1), g.count_emval_handles = () => V.length / 2 - 5 - Ha.length, g.noExitRuntime && (O = g.noExitRuntime), g.printErr && (A = g.printErr), g.wasmBinary && (C = g.wasmBinary);
    var Ab = { u: (a, b, d) => {
      var c = new Aa(a);
      throw J[c.I + 16 >> 2] = 0, J[c.I + 4 >> 2] = b, J[c.I + 8 >> 2] = d, Ba = a, Ca++, Ba;
    }, v: () => qa(""), l: (a, b, d) => {
      b = P(b), U(a, { name: b, fromWireType: (c) => c, toWireType: function(c, e) {
        if (typeof e != "bigint" && typeof e != "number")
          throw e === null ? e = "null" : (c = typeof e, e = c === "object" || c === "array" || c === "function" ? e.toString() : "" + e), new TypeError(`Cannot convert "${e}" to ${this.name}`);
        return typeof e == "number" && (e = BigInt(e)), e;
      }, H: 8, readValueFromPointer: Ga(b, d, b.indexOf("u") == -1), G: null });
    }, o: (a, b, d, c) => {
      b = P(b), U(a, { name: b, fromWireType: function(e) {
        return !!e;
      }, toWireType: function(e, f) {
        return f ? d : c;
      }, H: 8, readValueFromPointer: function(e) {
        return this.fromWireType(F[e]);
      }, G: null });
    }, m: (a) => U(a, Ma), k: (a, b, d) => {
      b = P(b), U(a, { name: b, fromWireType: (c) => c, toWireType: (c, e) => e, H: 8, readValueFromPointer: Na(b, d), G: null });
    }, c: (a, b, d, c, e, f, m) => {
      var h = Ua(b, d);
      a = P(a), a = db(a), e = Ya(c, e), Ta(a, function() {
        bb(`Cannot call ${a} due to unbound types`, h);
      }, b - 1), cb(h, (l) => {
        var k = [l[0], null].concat(l.slice(1));
        l = a;
        var p = a, z = e, n = k.length;
        if (2 > n)
          throw new T("argTypes array size mismatch! Must at least get return value and 'this' types!");
        var B = k[1] !== null && false, M = Pa(k), Qa = k[0].name !== "void";
        z = [p, Ea, z, f, Oa, k[0], k[1]];
        for (var x = 0;x < n - 2; ++x)
          z.push(k[x + 2]);
        if (!M)
          for (x = B ? 1 : 2;x < k.length; ++x)
            k[x].G !== null && z.push(k[x].G);
        M = Pa(k), x = k.length - 2;
        var r = [], N = ["fn"];
        for (B && N.push("thisWired"), n = 0;n < x; ++n)
          r.push(`arg${n}`), N.push(`arg${n}Wired`);
        r = r.join(","), N = N.join(","), r = `return function (${r}) {
`, M && (r += `var destructors = [];
`);
        var Ra = M ? "destructors" : "null", oa = "humanName throwBindingError invoker fn runDestructors retType classParam".split(" ");
        for (B && (r += `var thisWired = classParam['toWireType'](${Ra}, this);
`), n = 0;n < x; ++n)
          r += `var arg${n}Wired = argType${n}['toWireType'](${Ra}, arg${n});
`, oa.push(`argType${n}`);
        if (r += (Qa || m ? "var rv = " : "") + `invoker(${N});
`, M)
          r += `runDestructors(destructors);
`;
        else
          for (n = B ? 1 : 2;n < k.length; ++n)
            B = n === 1 ? "thisWired" : "arg" + (n - 2) + "Wired", k[n].G !== null && (r += `${B}_dtor(${B});
`, oa.push(`${B}_dtor`));
        Qa && (r += `var ret = retType['fromWireType'](rv);
return ret;
`);
        let [yb, zb] = [oa, r + `}
`];
        if (k = new Function(...yb, zb)(...z), p = Object.defineProperty(k, "name", { value: p }), k = b - 1, !g.hasOwnProperty(l))
          throw new Va("Replacing nonexistent public symbol");
        return g[l].F !== undefined && k !== undefined ? g[l].F[k] = p : (g[l] = p, g[l].J = k), [];
      });
    }, b: (a, b, d, c, e) => {
      if (b = P(b), e === -1 && (e = 4294967295), e = (h) => h, c === 0) {
        var f = 32 - 8 * d;
        e = (h) => h << f >>> f;
      }
      var m = b.includes("unsigned") ? function(h, l) {
        return l >>> 0;
      } : function(h, l) {
        return l;
      };
      U(a, { name: b, fromWireType: e, toWireType: m, H: 8, readValueFromPointer: Ga(b, d, c !== 0), G: null });
    }, a: (a, b, d) => {
      function c(f) {
        return new e(ja.buffer, J[f + 4 >> 2], J[f >> 2]);
      }
      var e = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array][b];
      d = P(d), U(a, { name: d, fromWireType: c, H: 8, readValueFromPointer: c }, { K: true });
    }, n: (a, b) => {
      b = P(b), U(a, { name: b, fromWireType: function(d) {
        for (var c = J[d >> 2], e = d + 4, f, m = e, h = 0;h <= c; ++h) {
          var l = e + h;
          (h == c || F[l] == 0) && (m = m ? fb(m, l - m) : "", f === undefined ? f = m : (f += "\x00", f += m), m = l + 1);
        }
        return W(d), f;
      }, toWireType: function(d, c) {
        c instanceof ArrayBuffer && (c = new Uint8Array(c));
        var e, f = typeof c == "string";
        if (!(f || ArrayBuffer.isView(c) && c.BYTES_PER_ELEMENT == 1))
          throw new T("Cannot pass non-string to std::string");
        var m;
        if (f)
          for (e = m = 0;e < c.length; ++e) {
            var h = c.charCodeAt(e);
            127 >= h ? m++ : 2047 >= h ? m += 2 : 55296 <= h && 57343 >= h ? (m += 4, ++e) : m += 3;
          }
        else
          m = c.length;
        if (e = m, m = wb(4 + e + 1), h = m + 4, J[m >> 2] = e, f) {
          if (f = h, h = e + 1, e = F, 0 < h) {
            h = f + h - 1;
            for (var l = 0;l < c.length; ++l) {
              var k = c.charCodeAt(l);
              if (55296 <= k && 57343 >= k) {
                var p = c.charCodeAt(++l);
                k = 65536 + ((k & 1023) << 10) | p & 1023;
              }
              if (127 >= k) {
                if (f >= h)
                  break;
                e[f++] = k;
              } else {
                if (2047 >= k) {
                  if (f + 1 >= h)
                    break;
                  e[f++] = 192 | k >> 6;
                } else {
                  if (65535 >= k) {
                    if (f + 2 >= h)
                      break;
                    e[f++] = 224 | k >> 12;
                  } else {
                    if (f + 3 >= h)
                      break;
                    e[f++] = 240 | k >> 18, e[f++] = 128 | k >> 12 & 63;
                  }
                  e[f++] = 128 | k >> 6 & 63;
                }
                e[f++] = 128 | k & 63;
              }
            }
            e[f] = 0;
          }
        } else
          F.set(c, h);
        return d !== null && d.push(W, m), m;
      }, H: 8, readValueFromPointer: La, G(d) {
        W(d);
      } });
    }, e: (a, b, d) => {
      if (d = P(d), b === 2)
        var c = hb, e = ib, f = jb, m = (h) => H[h >> 1];
      else
        b === 4 && (c = kb, e = lb, f = mb, m = (h) => J[h >> 2]);
      U(a, { name: d, fromWireType: (h) => {
        for (var l = J[h >> 2], k, p = h + 4, z = 0;z <= l; ++z) {
          var n = h + 4 + z * b;
          (z == l || m(n) == 0) && (p = c(p, n - p), k === undefined ? k = p : (k += "\x00", k += p), p = n + b);
        }
        return W(h), k;
      }, toWireType: (h, l) => {
        if (typeof l != "string")
          throw new T(`Cannot pass non-string to C++ string type ${d}`);
        var k = f(l), p = wb(4 + k + b);
        return J[p >> 2] = k / b, e(l, p + 4, k + b), h !== null && h.push(W, p), p;
      }, H: 8, readValueFromPointer: La, G(h) {
        W(h);
      } });
    }, f: (a) => {
      U(a, Ma);
    }, p: (a, b) => {
      b = P(b), U(a, { L: true, name: b, H: 0, fromWireType: () => {}, toWireType: () => {} });
    }, s: () => {
      O = false, nb = 0;
    }, i: (a, b, d, c) => (a = ob[a], b = Ja(b), a(null, b, d, c)), d: Ia, h: (a, b, d) => {
      b = rb(a, b);
      var c = b.shift();
      a--;
      var e = `return function (obj, func, destructorsRef, args) {
`, f = 0, m = [];
      d === 0 && m.push("obj");
      for (var h = ["retType"], l = [c], k = 0;k < a; ++k)
        m.push(`arg${k}`), h.push(`argType${k}`), l.push(b[k]), e += `  var arg${k} = argType${k}.readValueFromPointer(args${f ? "+" + f : ""});
`, f += b[k].H;
      return e += `  var rv = ${d === 1 ? "new func" : "func.call"}(${m.join(", ")});
`, c.L || (h.push("emval_returnValue"), l.push(sb), e += `  return emval_returnValue(retType, destructorsRef, rv);
`), a = new Function(...h, e + `};
`)(...l), d = `methodCaller<(${b.map((p) => p.name).join(", ")}) => ${c.name}>`, pb(Object.defineProperty(a, "name", { value: d }));
    }, q: (a) => {
      9 < a && (V[a + 1] += 1);
    }, g: (a) => {
      var b = Ja(a);
      Oa(b), Ia(a);
    }, j: (a, b) => (a = qb(a, "_emval_take_value"), a = a.readValueFromPointer(b), Ka(a)), t: (a, b) => {
      if (X[a] && (clearTimeout(X[a].id), delete X[a]), !b)
        return 0;
      var d = setTimeout(() => {
        delete X[a], ub(() => xb(a, performance.now()));
      }, b);
      return X[a] = { id: d, M: b }, 0;
    }, w: (a) => {
      var b = F.length;
      if (a >>>= 0, 2147483648 < a)
        return false;
      for (var d = 1;4 >= d; d *= 2) {
        var c = b * (1 + 0.2 / d);
        c = Math.min(c, a + 100663296);
        a: {
          c = (Math.min(2147483648, 65536 * Math.ceil(Math.max(a, c) / 65536)) - D.buffer.byteLength + 65535) / 65536 | 0;
          try {
            D.grow(c), pa();
            var e = 1;
            break a;
          } catch {}
          e = undefined;
        }
        if (e)
          return true;
      }
      return false;
    }, r: tb }, Z = await async function() {
      function a(c) {
        return Z = c.exports, D = Z.x, pa(), Xa = Z.D, K--, g.monitorRunDependencies?.(K), K == 0 && L && (c = L, L = null, c()), Z;
      }
      K++, g.monitorRunDependencies?.(K);
      var b = { a: Ab };
      if (g.instantiateWasm)
        return new Promise((c) => {
          g.instantiateWasm(b, (e, f) => {
            c(a(e, f));
          });
        });
      ra ??= g.locateFile ? g.locateFile ? g.locateFile("silk.wasm", v) : v + "silk.wasm" : new URL("silk.wasm", import_meta_url).href;
      try {
        var d = await ua(b);
        return a(d.instance);
      } catch (c) {
        return q(c), Promise.reject(c);
      }
    }(), $a = Z.z, wb = Z.A, W = Z.B, xb = Z.C;
    function Bb() {
      function a() {
        if (g.calledRun = true, !E) {
          if (Z.y(), aa(g), g.onRuntimeInitialized?.(), g.postRun)
            for (typeof g.postRun == "function" && (g.postRun = [g.postRun]);g.postRun.length; ) {
              var b = g.postRun.shift();
              xa.push(b);
            }
          wa(xa);
        }
      }
      if (0 < K)
        L = Bb;
      else {
        if (g.preRun)
          for (typeof g.preRun == "function" && (g.preRun = [g.preRun]);g.preRun.length; )
            za();
        wa(ya), 0 < K ? L = Bb : g.setStatus ? (g.setStatus("Running..."), setTimeout(() => {
          setTimeout(() => g.setStatus(""), 1), a();
        }, 1)) : a();
      }
    }
    if (g.preInit)
      for (typeof g.preInit == "function" && (g.preInit = [g.preInit]);0 < g.preInit.length; )
        g.preInit.shift()();
    return Bb(), moduleRtn = ba, moduleRtn;
  };
  var silk_default = Module;
  function isWavFile(fileData) {
    try {
      let chunks = unpackWavFileChunks(fileData), fmt = decodeFormatChunk(chunks.get("fmt")), data = chunks.get("data");
      return getWavFileType(fmt), verifyDataChunkLength(data, fmt), true;
    } catch {
      return false;
    }
  }
  var audioEncodingNames = ["int", "float"];
  var wavFileTypeAudioEncodings = [0, 0, 0, 1];
  function decodeWavFile(fileData) {
    let chunks = unpackWavFileChunks(fileData), fmt = decodeFormatChunk(chunks.get("fmt")), data = chunks.get("data"), wavFileType = getWavFileType(fmt), audioEncoding = wavFileTypeAudioEncodings[wavFileType], wavFileTypeName = audioEncodingNames[audioEncoding] + fmt.bitsPerSample;
    return verifyDataChunkLength(data, fmt), { channelData: decodeDataChunk(data, fmt, wavFileType), sampleRate: fmt.sampleRate, numberOfChannels: fmt.numberOfChannels, audioEncoding, bitsPerSample: fmt.bitsPerSample, wavFileTypeName };
  }
  function unpackWavFileChunks(fileData) {
    let dataView;
    fileData instanceof ArrayBuffer ? dataView = new DataView(fileData) : dataView = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
    let fileLength = dataView.byteLength;
    if (fileLength < 20)
      throw new Error("WAV file is too short.");
    if (getString(dataView, 0, 4) != "RIFF")
      throw new Error("Not a valid WAV file (no RIFF header).");
    let mainChunkLength = dataView.getUint32(4, true);
    if (8 + mainChunkLength != fileLength)
      throw new Error(`Main chunk length of WAV file (${8 + mainChunkLength}) does not match file size (${fileLength}).`);
    if (getString(dataView, 8, 4) != "WAVE")
      throw new Error("RIFF file is not a WAV file.");
    let chunks = new Map, fileOffset = 12;
    for (;fileOffset < fileLength; ) {
      if (fileOffset + 8 > fileLength)
        throw new Error(`Incomplete chunk prefix in WAV file at offset ${fileOffset}.`);
      let chunkId = getString(dataView, fileOffset, 4).trim(), chunkLength = dataView.getUint32(fileOffset + 4, true);
      if (fileOffset + 8 + chunkLength > fileLength)
        throw new Error(`Incomplete chunk data in WAV file at offset ${fileOffset}.`);
      let chunkData = new DataView(dataView.buffer, dataView.byteOffset + fileOffset + 8, chunkLength);
      chunks.set(chunkId, chunkData);
      let padLength = chunkLength % 2;
      fileOffset += 8 + chunkLength + padLength;
    }
    return chunks;
  }
  function getString(dataView, offset, length) {
    let a = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, length);
    return String.fromCharCode.apply(null, a);
  }
  function getInt24(dataView, offset) {
    let b0 = dataView.getInt8(offset + 2) * 65536, b12 = dataView.getUint16(offset, true);
    return b0 + b12;
  }
  function decodeFormatChunk(dataView) {
    if (!dataView)
      throw new Error("No format chunk found in WAV file.");
    if (dataView.byteLength < 16)
      throw new Error("Format chunk of WAV file is too short.");
    let fmt = {};
    return fmt.formatCode = dataView.getUint16(0, true), fmt.numberOfChannels = dataView.getUint16(2, true), fmt.sampleRate = dataView.getUint32(4, true), fmt.bytesPerSec = dataView.getUint32(8, true), fmt.bytesPerFrame = dataView.getUint16(12, true), fmt.bitsPerSample = dataView.getUint16(14, true), fmt;
  }
  function getWavFileType(fmt) {
    if (fmt.numberOfChannels < 1 || fmt.numberOfChannels > 999)
      throw new Error("Invalid number of channels in WAV file.");
    let bytesPerSample = Math.ceil(fmt.bitsPerSample / 8), expectedBytesPerFrame = fmt.numberOfChannels * bytesPerSample;
    if (fmt.formatCode == 1 && fmt.bitsPerSample >= 1 && fmt.bitsPerSample <= 8 && fmt.bytesPerFrame == expectedBytesPerFrame)
      return 0;
    if (fmt.formatCode == 1 && fmt.bitsPerSample >= 9 && fmt.bitsPerSample <= 16 && fmt.bytesPerFrame == expectedBytesPerFrame)
      return 1;
    if (fmt.formatCode == 1 && fmt.bitsPerSample >= 17 && fmt.bitsPerSample <= 24 && fmt.bytesPerFrame == expectedBytesPerFrame)
      return 2;
    if (fmt.formatCode == 3 && fmt.bitsPerSample == 32 && fmt.bytesPerFrame == expectedBytesPerFrame)
      return 3;
    throw new Error(`Unsupported WAV file type, formatCode=${fmt.formatCode}, bitsPerSample=${fmt.bitsPerSample}, bytesPerFrame=${fmt.bytesPerFrame}, numberOfChannels=${fmt.numberOfChannels}.`);
  }
  function decodeDataChunk(data, fmt, wavFileType) {
    switch (wavFileType) {
      case 0:
        return decodeDataChunk_uint8(data, fmt);
      case 1:
        return decodeDataChunk_int16(data, fmt);
      case 2:
        return decodeDataChunk_int24(data, fmt);
      case 3:
        return decodeDataChunk_float32(data, fmt);
      default:
        throw new Error("No decoder.");
    }
  }
  function decodeDataChunk_int16(data, fmt) {
    let channelData = allocateChannelDataArrays(data.byteLength, fmt), numberOfChannels = fmt.numberOfChannels, numberOfFrames = channelData[0].length, offs = 0;
    for (let frameNo = 0;frameNo < numberOfFrames; frameNo++)
      for (let channelNo = 0;channelNo < numberOfChannels; channelNo++) {
        let sampleValueFloat = data.getInt16(offs, true) / 32768;
        channelData[channelNo][frameNo] = sampleValueFloat, offs += 2;
      }
    return channelData;
  }
  function decodeDataChunk_uint8(data, fmt) {
    let channelData = allocateChannelDataArrays(data.byteLength, fmt), numberOfChannels = fmt.numberOfChannels, numberOfFrames = channelData[0].length, offs = 0;
    for (let frameNo = 0;frameNo < numberOfFrames; frameNo++)
      for (let channelNo = 0;channelNo < numberOfChannels; channelNo++) {
        let sampleValueFloat = (data.getUint8(offs) - 128) / 128;
        channelData[channelNo][frameNo] = sampleValueFloat, offs += 1;
      }
    return channelData;
  }
  function decodeDataChunk_int24(data, fmt) {
    let channelData = allocateChannelDataArrays(data.byteLength, fmt), numberOfChannels = fmt.numberOfChannels, numberOfFrames = channelData[0].length, offs = 0;
    for (let frameNo = 0;frameNo < numberOfFrames; frameNo++)
      for (let channelNo = 0;channelNo < numberOfChannels; channelNo++) {
        let sampleValueFloat = getInt24(data, offs) / 8388608;
        channelData[channelNo][frameNo] = sampleValueFloat, offs += 3;
      }
    return channelData;
  }
  function decodeDataChunk_float32(data, fmt) {
    let channelData = allocateChannelDataArrays(data.byteLength, fmt), numberOfChannels = fmt.numberOfChannels, numberOfFrames = channelData[0].length, offs = 0;
    for (let frameNo = 0;frameNo < numberOfFrames; frameNo++)
      for (let channelNo = 0;channelNo < numberOfChannels; channelNo++) {
        let sampleValueFloat = data.getFloat32(offs, true);
        channelData[channelNo][frameNo] = sampleValueFloat, offs += 4;
      }
    return channelData;
  }
  function allocateChannelDataArrays(dataLength, fmt) {
    let numberOfFrames = Math.floor(dataLength / fmt.bytesPerFrame), channelData = new Array(fmt.numberOfChannels);
    for (let channelNo = 0;channelNo < fmt.numberOfChannels; channelNo++)
      channelData[channelNo] = new Float32Array(numberOfFrames);
    return channelData;
  }
  function verifyDataChunkLength(data, fmt) {
    if (!data)
      throw new Error("No data chunk found in WAV file.");
    if (data.byteLength % fmt.bytesPerFrame != 0)
      throw new Error("WAV file data chunk length is not a multiple of frame size.");
  }
  function getWavFileInfo(fileData) {
    let chunks = unpackWavFileChunks(fileData), chunkInfo = getChunkInfo(chunks), fmt = decodeFormatChunk(chunks.get("fmt"));
    return { chunkInfo, fmt };
  }
  function getChunkInfo(chunks) {
    let chunkInfo = [];
    for (let e of chunks) {
      let ci = {};
      ci.chunkId = e[0], ci.dataOffset = e[1].byteOffset, ci.dataLength = e[1].byteLength, chunkInfo.push(ci);
    }
    return chunkInfo.sort((e1, e2) => e1.dataOffset - e2.dataOffset), chunkInfo;
  }
  function ensureMonoPcm(channelData) {
    let { length: numberOfChannels } = channelData;
    if (numberOfChannels === 1)
      return channelData[0];
    let monoData = new Float32Array(channelData[0].length);
    for (let i = 0;i < monoData.length; i++) {
      let sum = 0;
      for (let j = 0;j < numberOfChannels; j++)
        sum += channelData[j][i];
      monoData[i] = sum / numberOfChannels;
    }
    return monoData;
  }
  function ensureS16lePcm(input) {
    let int16Array = new Int16Array(input.length);
    for (let offset = 0;offset < input.length; offset++) {
      let x = ~~(input[offset] * 32768);
      int16Array[offset] = x > 32767 ? 32767 : x;
    }
    return int16Array.buffer;
  }
  function toUTF8String(input, start = 0, end = input.byteLength) {
    return new TextDecoder().decode(input.slice(start, end));
  }
  function binaryFromSource(source) {
    return ArrayBuffer.isView(source) ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : source;
  }
  async function encode(input, sampleRate) {
    let instance = await silk_default(), buffer = binaryFromSource(input);
    if (!buffer?.byteLength)
      throw new Error("input data length is 0");
    if (isWavFile(input)) {
      let { channelData, sampleRate: wavSampleRate } = decodeWavFile(input);
      sampleRate ||= wavSampleRate, buffer = ensureS16lePcm(ensureMonoPcm(channelData));
    }
    let data = new Uint8Array, duration = instance.silk_encode(buffer, sampleRate, (output) => {
      data = output.slice();
    });
    if (duration === 0)
      throw new Error("silk encoding failure");
    return { data, duration };
  }
  async function decode(input, sampleRate) {
    let instance = await silk_default(), buffer = binaryFromSource(input);
    if (!buffer?.byteLength)
      throw new Error("input data length is 0");
    let data = new Uint8Array, duration = instance.silk_decode(buffer, sampleRate, (output) => {
      output.length > 0 && (data = output.slice());
    });
    if (duration === 0)
      throw new Error("silk decoding failure");
    return { data, duration };
  }
  function getDuration(data, frameMs = 20) {
    let buffer = binaryFromSource(data), view = new DataView(buffer), byteLength = view.byteLength, offset = view.getUint8(0) === 2 ? 10 : 9, blocks = 0;
    for (;offset < byteLength; ) {
      let size = view.getUint16(offset, true);
      blocks += 1, offset += size + 2;
    }
    return blocks * frameMs;
  }
  function isWav(data) {
    return isWavFile(data);
  }
  function getWavFileInfo2(data) {
    return getWavFileInfo(data);
  }
  function isSilk(data) {
    let buffer = binaryFromSource(data);
    return buffer.byteLength < 7 ? false : toUTF8String(buffer, 0, 7).includes("#!SILK");
  }
});

// ../../packages/extension-sdk/src/platform.ts
class BackendHandle {
  _backend;
  _listeners = new Map;
  constructor(backend) {
    this._backend = backend;
  }
  swap(newBackend) {
    for (const [event, listeners] of this._listeners) {
      for (const fn of listeners) {
        this._backend.off(event, fn);
      }
    }
    this._backend = newBackend;
    for (const [event, listeners] of this._listeners) {
      for (const fn of listeners) {
        this._backend.on(event, fn);
      }
    }
  }
  on(event, listener) {
    if (!this._listeners.has(event))
      this._listeners.set(event, new Set);
    this._listeners.get(event).add(listener);
    this._backend.on(event, listener);
    return this;
  }
  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
    this._backend.off(event, listener);
    return this;
  }
  once(event, listener) {
    const wrapper = (...args) => {
      this._listeners.get(event)?.delete(wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }
  chat(sessionId, text, images, documents, platform) {
    return this._backend.chat(sessionId, text, images, documents, platform);
  }
  isStreamEnabled() {
    return this._backend.isStreamEnabled();
  }
  clearSession(sessionId) {
    return this._backend.clearSession(sessionId);
  }
  switchModel(modelName, platform) {
    return this._backend.switchModel(modelName, platform);
  }
  listModels() {
    return this._backend.listModels();
  }
  listSessionMetas() {
    return this._backend.listSessionMetas();
  }
  abortChat(sessionId) {
    return this._backend.abortChat(sessionId);
  }
  getToolHandle(toolId) {
    return this._backend.getToolHandle(toolId);
  }
  getToolHandles(sessionId) {
    return this._backend.getToolHandles(sessionId);
  }
  undo(sessionId, scope) {
    return this._backend.undo?.(sessionId, scope) ?? Promise.resolve(null);
  }
  redo(sessionId) {
    return this._backend.redo?.(sessionId) ?? Promise.resolve(null);
  }
  listSkills() {
    return this._backend.listSkills?.() ?? [];
  }
  listModes() {
    return this._backend.listModes?.() ?? [];
  }
  switchMode(modeName) {
    return this._backend.switchMode?.(modeName) ?? false;
  }
  clearRedo(sessionId) {
    return this._backend.clearRedo?.(sessionId);
  }
  getHistory(sessionId) {
    return this._backend.getHistory?.(sessionId) ?? Promise.resolve([]);
  }
  runCommand(cmd) {
    return this._backend.runCommand?.(cmd);
  }
  summarize(sessionId) {
    return this._backend.summarize?.(sessionId) ?? Promise.resolve(undefined);
  }
  resetConfigToDefaults() {
    return this._backend.resetConfigToDefaults?.();
  }
  getToolNames() {
    return this._backend.getToolNames?.() ?? [];
  }
  getAgentTasks(sessionId) {
    return this._backend.getAgentTasks?.(sessionId) ?? [];
  }
  getRunningAgentTasks(sessionId) {
    return this._backend.getRunningAgentTasks?.(sessionId) ?? [];
  }
  getAgentTask(taskId) {
    return this._backend.getAgentTask?.(taskId);
  }
  getToolPolicies() {
    return this._backend.getToolPolicies?.();
  }
  getCurrentModelInfo() {
    return this._backend.getCurrentModelInfo?.();
  }
  getDisabledTools() {
    return this._backend.getDisabledTools?.();
  }
  getActiveSessionId() {
    return this._backend.getActiveSessionId?.();
  }
}
function getPlatformConfig(context, platformName) {
  const platform = context.config?.platform;
  if (!platform || typeof platform !== "object") {
    return {};
  }
  const value = platform[platformName];
  if (!value || typeof value !== "object") {
    return {};
  }
  return value;
}
function definePlatformFactory(options) {
  return async (context) => {
    const raw = getPlatformConfig(context, options.platformName);
    const config = options.resolveConfig(raw, context);
    return await options.create(context.backend, config, context);
  };
}
function splitText(text, maxLen) {
  if (text.length <= maxLen)
    return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf(`
`, maxLen);
    if (splitAt <= 0)
      splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}

class PlatformAdapter {
  get name() {
    return this.constructor.name;
  }
}
// ../../packages/extension-sdk/src/logger.ts
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
// ../../packages/extension-sdk/src/platform-utils.ts
var TOOL_STATUS_ICONS = {
  queued: "⏳",
  executing: "\uD83D\uDD27",
  success: "✅",
  error: "❌",
  streaming: "\uD83D\uDCE1",
  awaiting_approval: "\uD83D\uDD10",
  awaiting_apply: "\uD83D\uDCCB",
  warning: "⚠️"
};
var TOOL_STATUS_LABELS = {
  queued: "等待中",
  executing: "执行中",
  success: "成功",
  error: "失败",
  streaming: "输出中",
  awaiting_approval: "等待审批",
  awaiting_apply: "等待应用",
  warning: "警告"
};
function formatToolStatusLine(inv, options) {
  const icon = TOOL_STATUS_ICONS[inv.status] || "⏳";
  const label = TOOL_STATUS_LABELS[inv.status] || inv.status;
  const name = options?.codeStyle ? `\`${inv.toolName}\`` : inv.toolName;
  return `${icon} ${name} ${label}`;
}
function autoApproveHandle(handle) {
  if (handle.status === "awaiting_approval") {
    try {
      handle.approve(true);
    } catch {}
  }
  handle.on("state", (status) => {
    if (status === "awaiting_approval") {
      try {
        handle.approve(true);
      } catch {}
    }
  });
}
// src/index.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
var logger = createExtensionLogger("WeixinExtension", "Weixin");
var SILK_SAMPLE_RATE = 24000;
var WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
var MESSAGE_MAX_LENGTH = 4000;
var CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
var POLL_RETRY_DELAY_MS = 2000;
var POLL_MAX_RETRY_DELAY_MS = 30000;
var SESSION_COOLDOWN_MS = 3600000;
var UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4
};
var MessageType = {
  USER: 1,
  BOT: 2
};
var MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5
};
var MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2
};
var TypingStatus = {
  TYPING: 1,
  CANCEL: 2
};

class WeixinPlatform extends PlatformAdapter {
  backend;
  config;
  baseUrl;
  configDir;
  polling = false;
  getUpdatesBuf = "";
  cooldownUntil = 0;
  chatStates = new Map;
  activeSessions = new Map;
  constructor(backend, config) {
    super();
    this.backend = backend;
    this.config = config;
    this.baseUrl = (config.baseUrl || "https://ilinkai.weixin.qq.com").replace(/\/$/, "");
    this.configDir = path.resolve(config.configDir || path.join(process.cwd(), "data", "configs"));
    if (!this.config.botToken) {
      this.loadTokenFromCache();
    }
  }
  loadTokenFromCache() {
    const cachePath = path.join(this.configDir, "weixin-auth.json");
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
        if (data.botToken) {
          this.config.botToken = data.botToken;
          if (data.baseUrl)
            this.baseUrl = data.baseUrl.replace(/\/$/, "");
          logger.info("从本地缓存加载了微信 Token");
        }
      } catch (err) {
        logger.debug("读取微信 Token 缓存失败:", err);
      }
    }
  }
  saveTokenToCache(botToken, baseUrl) {
    const dir = this.configDir;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const cachePath = path.join(dir, "weixin-auth.json");
      fs.writeFileSync(cachePath, JSON.stringify({ botToken, baseUrl }, null, 2));
      logger.info(`微信 Token 已保存到本地缓存`);
    } catch (err) {
      logger.warn("保存微信 Token 到缓存失败:", err);
    }
  }
  async start() {
    if (!this.config.botToken) {
      logger.info("未配置 botToken，准备扫码登录...");
      const { botToken, baseUrl } = await this.performQRLogin();
      this.config.botToken = botToken;
      this.baseUrl = baseUrl.replace(/\/$/, "");
      this.saveTokenToCache(botToken, baseUrl);
    }
    this.setupBackendListeners();
    this.polling = true;
    this.runPollingLoop().catch((err) => {
      logger.error("长轮询循环异常退出:", err);
    });
    logger.info(`微信平台启动成功 (BaseUrl: ${this.baseUrl})`);
  }
  async performQRLogin(retryCount = 0) {
    const qrcodeResp = await fetch(`${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`);
    if (!qrcodeResp.ok)
      throw new Error(`获取二维码失败: ${await qrcodeResp.text()}`);
    const qrcodeData = await qrcodeResp.json();
    const qrcode = qrcodeData.qrcode;
    const qrcodeUrl = qrcodeData.qrcode_img_content ?? qrcodeData.qrcode_url ?? "";
    logger.info("----------------------------------------");
    logger.info("请在浏览器打开以下链接扫码登录微信：");
    logger.info(`
${qrcodeUrl}
`);
    logger.info("----------------------------------------");
    while (true) {
      const statusResp = await fetch(`${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`);
      if (!statusResp.ok)
        throw new Error(`获取二维码状态失败: ${await statusResp.text()}`);
      const statusData = await statusResp.json();
      if (statusData.status === "confirmed") {
        logger.info("扫码登录成功！");
        return {
          botToken: statusData.bot_token,
          baseUrl: statusData.baseurl || this.baseUrl
        };
      } else if (statusData.status === "expired") {
        if (retryCount < 3) {
          logger.warn("二维码已过期，正在重新获取...");
          return this.performQRLogin(retryCount + 1);
        }
        throw new Error("二维码已多次过期，请重新启动程序");
      } else if (statusData.status === "scaned") {
        logger.info("已扫码，请在微信确认...");
      }
      await this.sleep(2000);
    }
  }
  async stop() {
    this.polling = false;
    this.chatStates.clear();
    logger.info("平台已停止");
  }
  async apiCall(endpoint, body, label) {
    const url = `${this.baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
    const jsonBody = JSON.stringify({
      ...body,
      base_info: { channel_version: "2.0.1" }
    });
    const headers = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${(this.config.botToken || "").trim()}`,
      "X-WECHAT-UIN": this.randomWechatUin()
    };
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: jsonBody
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`${label} HTTP ${resp.status}: ${text}`);
      }
      return await resp.json();
    } catch (err) {
      logger.debug(`${label} 失败:`, err);
      throw err;
    }
  }
  randomWechatUin() {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32), "utf-8").toString("base64");
  }
  async getUpdates(buf) {
    return this.apiCall("ilink/bot/getupdates", { get_updates_buf: buf }, "getUpdates");
  }
  async sendMessage(msg) {
    await this.apiCall("ilink/bot/sendmessage", { msg }, "sendMessage");
  }
  async sendTyping(userId, ticket, status) {
    await this.apiCall("ilink/bot/sendtyping", {
      ilink_user_id: userId,
      typing_ticket: ticket,
      status
    }, "sendTyping");
  }
  async getConfig(userId) {
    return this.apiCall("ilink/bot/getconfig", {
      ilink_user_id: userId
    }, "getConfig");
  }
  async getUploadUrl(params) {
    return this.apiCall("ilink/bot/getuploadurl", params, "getUploadUrl");
  }
  aesEcbEncrypt(plaintext, key) {
    const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  }
  aesEcbDecrypt(ciphertext, key) {
    const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
  aesEcbPaddedSize(plaintextSize) {
    return Math.ceil((plaintextSize + 1) / 16) * 16;
  }
  parseAesKey(aesKeyBase64) {
    const decoded = Buffer.from(aesKeyBase64, "base64");
    if (decoded.length === 16)
      return decoded;
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
      return Buffer.from(decoded.toString("ascii"), "hex");
    }
    throw new Error(`无法解析 AES key: ${aesKeyBase64}`);
  }
  async downloadMedia(encryptQueryParam, aesKey) {
    const key = aesKey ? this.parseAesKey(aesKey) : null;
    const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
    const maxRetries = 3;
    let lastError = null;
    for (let attempt = 1;attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController;
        const timeout = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) {
          const body = await res.text().catch(() => "(unreadable)");
          throw new Error(`CDN download ${res.status}: ${body}`);
        }
        const raw = Buffer.from(await res.arrayBuffer());
        return key ? this.aesEcbDecrypt(raw, key) : raw;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(`下载媒体失败 (attempt ${attempt}/${maxRetries}): ${lastError.message}`);
        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt);
        }
      }
    }
    throw lastError;
  }
  async uploadMedia(buffer, mediaType, userId) {
    const aesKey = crypto.randomBytes(16);
    const rawsize = buffer.length;
    const rawfilemd5 = crypto.createHash("md5").update(buffer).digest("hex");
    const filesize = this.aesEcbPaddedSize(rawsize);
    const filekey = crypto.randomBytes(16).toString("hex");
    const uploadUrlResp = await this.getUploadUrl({
      filekey,
      media_type: mediaType,
      to_user_id: userId,
      rawsize,
      rawfilemd5,
      filesize,
      no_need_thumb: true,
      aeskey: aesKey.toString("hex")
    });
    if (!uploadUrlResp.upload_param) {
      throw new Error("获取上传 URL 失败：没有 upload_param");
    }
    const ciphertext = this.aesEcbEncrypt(buffer, aesKey);
    const uploadUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadUrlResp.upload_param)}&filekey=${encodeURIComponent(filekey)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(ciphertext)
    });
    if (!uploadRes.ok) {
      const errMsg = uploadRes.headers.get("x-error-message") || await uploadRes.text();
      throw new Error(`CDN 上传失败 ${uploadRes.status}: ${errMsg}`);
    }
    const downloadParam = uploadRes.headers.get("x-encrypted-param");
    if (!downloadParam) {
      throw new Error("CDN 响应缺少 x-encrypted-param");
    }
    return {
      encryptQueryParam: downloadParam,
      aesKey: aesKey.toString("hex"),
      fileSizeCiphertext: filesize
    };
  }
  async silkToWav(silkBuf) {
    try {
      const { decode } = await Promise.resolve().then(() => __toESM(require_lib(), 1));
      logger.debug(`silkToWav: 解码 ${silkBuf.length} 字节 SILK`);
      const result = await decode(silkBuf, SILK_SAMPLE_RATE);
      const wav = pcmBytesToWav(result.data, SILK_SAMPLE_RATE);
      return wav;
    } catch (err) {
      if (err.code === "MODULE_NOT_FOUND") {
        logger.warn("silk-wasm 未安装，跳过语音转码");
      } else {
        logger.warn("silkToWav 失败:", err);
      }
      return null;
    }
  }
  async runPollingLoop() {
    let retryDelay = POLL_RETRY_DELAY_MS;
    while (this.polling) {
      if (Date.now() < this.cooldownUntil) {
        await this.sleep(5000);
        continue;
      }
      try {
        const resp = await this.getUpdates(this.getUpdatesBuf);
        const errCode = resp.errcode ?? resp.ret ?? 0;
        if (errCode !== 0) {
          if (errCode === -14) {
            logger.error("微信会话已失效 (Error -14)，进入1小时冷却期");
            this.cooldownUntil = Date.now() + SESSION_COOLDOWN_MS;
            continue;
          }
          throw new Error(`API Error: ${errCode} ${resp.errmsg}`);
        }
        if (resp.get_updates_buf) {
          this.getUpdatesBuf = resp.get_updates_buf;
        }
        const msgs = resp.msgs || [];
        for (const msg of msgs) {
          this.handleIncomingMessage(msg).catch((err) => {
            logger.error("消息处理失败:", err);
          });
        }
        retryDelay = POLL_RETRY_DELAY_MS;
      } catch (err) {
        logger.warn(`轮询失败: ${err instanceof Error ? err.message : String(err)}，将在 ${retryDelay}ms 后重试`);
        await this.sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, POLL_MAX_RETRY_DELAY_MS);
      }
    }
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  getChatState(userId) {
    let cs = this.chatStates.get(userId);
    if (!cs) {
      cs = {
        busy: false,
        sessionId: this.getSessionId(userId),
        contextToken: null,
        typingTicket: null,
        buffer: "",
        toolBuffer: "",
        committedToolIds: new Set,
        stopped: false,
        pendingMessages: []
      };
      this.chatStates.set(userId, cs);
    }
    cs.sessionId = this.getSessionId(userId);
    return cs;
  }
  getSessionId(userId) {
    let sid = this.activeSessions.get(userId);
    if (!sid) {
      sid = `weixin-${userId}-${Date.now()}`;
      this.activeSessions.set(userId, sid);
    }
    return sid;
  }
  async handleIncomingMessage(msg) {
    if (msg.message_type === MessageType.BOT)
      return;
    const userId = msg.from_user_id;
    if (!userId)
      return;
    const parsed = parseMessageBody(msg);
    if (!parsed.text && parsed.imageUrls.length === 0 && parsed.mediaItems.length === 0)
      return;
    logger.info(`[${userId}] 收到消息: text="${parsed.text.slice(0, 50)}${parsed.text.length > 50 ? "..." : ""}" images=${parsed.imageUrls.length}`);
    if (parsed.text.startsWith("/")) {
      const handled = await this.handleCommand(parsed.text, msg, userId);
      if (handled)
        return;
    }
    const cs = this.getChatState(userId);
    cs.contextToken = msg.context_token || cs.contextToken;
    if (cs.busy) {
      cs.pendingMessages.push({ text: parsed.text, message: msg, mediaItems: parsed.mediaItems });
      const count = cs.pendingMessages.length;
      await this.reply(userId, cs.contextToken, `\uD83D\uDCE5 消息已暂存 (共 ${count} 条)，等 AI 回复结束后自动发送。
发送 /flush 可立即处理，/stop 可中止。`);
      return;
    }
    const images = [];
    for (const item of parsed.mediaItems) {
      try {
        const buf = await this.downloadMedia(item.encryptQueryParam, item.aesKey);
        if (item.type === MessageItemType.IMAGE) {
          images.push({
            data: buf.toString("base64"),
            mimeType: "image/jpeg"
          });
        } else if (item.type === MessageItemType.VOICE) {
          const wav = await this.silkToWav(buf);
          if (wav) {
            logger.debug(`[${userId}] 成功解密并转码语音: ${wav.length} 字节`);
          }
        }
      } catch (err) {
        logger.error(`[${userId}] 下载/解密媒体失败:`, err);
      }
    }
    if (!cs.typingTicket) {
      this.getConfig(userId).then((resp) => {
        if (resp.typing_ticket)
          cs.typingTicket = resp.typing_ticket;
      }).catch(() => {});
    }
    let chatText = parsed.text;
    if (!chatText && images.length > 0) {
      chatText = "[图片消息]";
    } else if (!chatText && parsed.mediaItems.length > 0 && images.length === 0) {
      chatText = "[媒体消息（下载失败）]";
    }
    if (!chatText) {
      return;
    }
    await this.dispatchChat(cs, chatText, msg, images.length > 0 ? images : undefined);
  }
  async dispatchChat(cs, text, msg, images) {
    cs.busy = true;
    cs.stopped = false;
    cs.buffer = "";
    cs.toolBuffer = "";
    cs.committedToolIds.clear();
    try {
      await this.backend.chat(cs.sessionId, text, images, undefined, "weixin");
    } catch (err) {
      logger.error(`backend.chat 失败 (session=${cs.sessionId}):`, err);
      cs.busy = false;
    }
  }
  findUserIdBySid(sid) {
    for (const [userId, cs] of this.chatStates.entries()) {
      if (cs.sessionId === sid)
        return userId;
    }
    return;
  }
  setupBackendListeners() {
    this.backend.on("stream:start", (sid) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId)
        return;
      const cs = this.getChatState(userId);
      if (cs.typingTicket) {
        this.sendTyping(userId, cs.typingTicket, TypingStatus.TYPING).catch(() => {});
      }
    });
    this.backend.on("stream:chunk", (sid, chunk) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId)
        return;
      const cs = this.getChatState(userId);
      if (cs.stopped)
        return;
      cs.buffer += chunk;
    });
    this.backend.on("response", (sid, text) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId)
        return;
      const cs = this.getChatState(userId);
      if (cs.stopped)
        return;
      cs.buffer = text;
    });
    this.backend.on("tool:execute", (sid, handle) => {
      autoApproveHandle(handle);
      if (this.config.showToolStatus === false)
        return;
      const userId = this.findUserIdBySid(sid);
      if (!userId)
        return;
      const cs = this.getChatState(userId);
      if (cs.stopped)
        return;
      handle.on("done", () => {
        const line = formatToolStatusLine({ toolName: handle.toolName, status: handle.status });
        if (!cs.committedToolIds.has(handle.id)) {
          cs.committedToolIds.add(handle.id);
          cs.toolBuffer += `${line}
`;
        }
      });
    });
    this.backend.on("error", (sid, errorMsg) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId)
        return;
      const cs = this.getChatState(userId);
      if (cs.stopped)
        return;
      this.reply(userId, cs.contextToken, `❌ 错误: ${errorMsg}`).catch(() => {});
    });
    this.backend.on("attachments", async (sid, attachments) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId)
        return;
      const cs = this.getChatState(userId);
      for (const attachment of attachments) {
        try {
          const isImage = attachment.type.startsWith("image/");
          const mediaType = isImage ? UploadMediaType.IMAGE : UploadMediaType.FILE;
          const uploaded = await this.uploadMedia(attachment.data, mediaType, userId);
          const item = {};
          if (isImage) {
            item.type = MessageItemType.IMAGE;
            item.image_item = {
              media: {
                encrypt_query_param: uploaded.encryptQueryParam,
                aes_key: Buffer.from(uploaded.aesKey, "hex").toString("base64")
              },
              hd_size: uploaded.fileSizeCiphertext
            };
          } else {
            item.type = MessageItemType.FILE;
            item.file_item = {
              media: {
                encrypt_query_param: uploaded.encryptQueryParam,
                aes_key: Buffer.from(uploaded.aesKey, "hex").toString("base64")
              },
              file_name: attachment.fileName || "file.bin",
              len: String(attachment.data.length)
            };
          }
          await this.sendMessage({
            to_user_id: userId,
            message_type: MessageType.BOT,
            item_list: [item],
            context_token: cs.contextToken || undefined
          });
        } catch (err) {
          logger.error(`[${userId}] 发送附件失败:`, err);
        }
      }
    });
    this.backend.on("done", (sid) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId)
        return;
      const cs = this.getChatState(userId);
      if (cs.typingTicket) {
        this.sendTyping(userId, cs.typingTicket, TypingStatus.CANCEL).catch(() => {});
      }
      if (!cs.stopped) {
        const finalContent = [
          cs.toolBuffer.trim(),
          cs.buffer.trim()
        ].filter(Boolean).join(`

`) || "✅ 处理完成。";
        this.reply(userId, cs.contextToken, finalContent).catch((err) => {
          logger.error(`最终消息发送失败 (userId=${userId}):`, err);
        });
      }
      cs.busy = false;
      cs.stopped = false;
      if (cs.pendingMessages.length > 0) {
        this.flushPendingMessages(cs, userId);
      }
    });
  }
  async reply(userId, contextToken, text) {
    if (!text)
      return;
    const plainText = markdownToPlainText(text);
    const chunks = splitText(plainText, MESSAGE_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.sendMessage({
        to_user_id: userId,
        client_id: `iris-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: contextToken || undefined,
        item_list: [{
          type: MessageItemType.TEXT,
          text_item: { text: chunk }
        }]
      });
    }
  }
  flushPendingMessages(cs, userId) {
    if (cs.pendingMessages.length === 0)
      return;
    const messages = cs.pendingMessages.splice(0);
    const combinedText = messages.map((m) => m.text).join(`
`);
    const { message: latestMsg } = messages[messages.length - 1];
    logger.info(`[${userId}] 合并 ${messages.length} 条缓冲消息发送`);
    this.handleIncomingMessage({ ...latestMsg, item_list: [{ type: MessageItemType.TEXT, text_item: { text: combinedText } }] }).catch(() => {});
  }
  async handleCommand(text, msg, userId) {
    const cmd = text.trim().toLowerCase();
    const cs = this.getChatState(userId);
    const ctxToken = msg.context_token || cs.contextToken;
    const fastReply = (content) => this.reply(userId, ctxToken, content);
    if (cmd === "/new") {
      const newSid = `weixin-${userId}-${Date.now()}`;
      this.activeSessions.set(userId, newSid);
      await fastReply("✅ 已新建对话，上下文已清空。");
      return true;
    }
    if (cmd === "/stop") {
      if (!cs.busy) {
        await fastReply("ℹ️ 当前没有正在进行的回复。");
        return true;
      }
      cs.stopped = true;
      this.backend.abortChat(cs.sessionId);
      await fastReply("⏹ 已中止回复。");
      return true;
    }
    if (cmd === "/flush") {
      if (!cs.busy && cs.pendingMessages.length === 0) {
        await fastReply("ℹ️ 当前没有正在进行的回复或缓冲中的消息。");
        return true;
      }
      if (cs.busy) {
        cs.stopped = true;
        this.backend.abortChat(cs.sessionId);
      } else {
        this.flushPendingMessages(cs, userId);
      }
      await fastReply("⏹ 已中止当前任务并处理缓冲消息。");
      return true;
    }
    if (cmd === "/help") {
      await fastReply([
        "\uD83D\uDCCB 可用指令",
        "/new — 新建对话",
        "/stop — 中止回复",
        "/flush — 立即处理缓冲消息",
        "/model — 查看/切换模型",
        "/help — 帮助"
      ].join(`
`));
      return true;
    }
    if (cmd === "/model" || cmd === "/models") {
      const models = this.backend.listModels();
      const lines = models.map((m) => `${m.current ? "\uD83D\uDC49 " : "　 "}**${m.modelName}** → \`${m.modelId}\``);
      await fastReply(`当前可用模型：
${lines.join(`
`)}

切换模型请发送 /model 模型名`);
      return true;
    }
    if (cmd.startsWith("/model ")) {
      const modelName = text.slice("/model ".length).trim();
      try {
        const result = this.backend.switchModel(modelName, "weixin");
        await fastReply(`✅ 模型已切换为 **${result.modelName}**`);
      } catch {
        await fastReply(`❌ 未找到模型 "${modelName}"`);
      }
      return true;
    }
    return false;
  }
}
function parseMessageBody(msg) {
  const parts = [];
  const imageUrls = [];
  const mediaItems = [];
  if (msg.item_list && msg.item_list.length > 0) {
    for (const item of msg.item_list) {
      if (item.type === MessageItemType.TEXT && item.text_item?.text) {
        parts.push(item.text_item.text);
      } else if (item.type === MessageItemType.IMAGE && item.image_item?.url) {
        imageUrls.push(item.image_item.url);
        logger.debug(`收到图片消息: ${item.image_item.url}`);
      } else if (item.type === MessageItemType.VOICE) {
        if (item.voice_item?.text)
          parts.push(item.voice_item.text);
      } else if (item.type === MessageItemType.FILE) {
        if (item.file_item?.file_name)
          parts.push(`[文件: ${item.file_item.file_name}]`);
      }
      if (item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param) {
        const img = item.image_item;
        const aesKey = img.aeskey ? Buffer.from(img.aeskey, "hex").toString("base64") : img.media.aes_key;
        mediaItems.push({
          type: MessageItemType.IMAGE,
          encryptQueryParam: img.media.encrypt_query_param,
          aesKey: aesKey || undefined
        });
      } else if (item.type === MessageItemType.VOICE && item.voice_item?.media?.encrypt_query_param && item.voice_item.media.aes_key) {
        mediaItems.push({
          type: MessageItemType.VOICE,
          encryptQueryParam: item.voice_item.media.encrypt_query_param,
          aesKey: item.voice_item.media.aes_key
        });
      } else if (item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param && item.file_item.media.aes_key) {
        mediaItems.push({
          type: MessageItemType.FILE,
          encryptQueryParam: item.file_item.media.encrypt_query_param,
          aesKey: item.file_item.media.aes_key,
          fileName: item.file_item.file_name
        });
      } else if (item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param && item.video_item.media.aes_key) {
        mediaItems.push({
          type: MessageItemType.VIDEO,
          encryptQueryParam: item.video_item.media.encrypt_query_param,
          aesKey: item.video_item.media.aes_key
        });
      }
      if (item.ref_msg?.message_item) {
        const ref = item.ref_msg.message_item;
        if (ref.type === MessageItemType.IMAGE && ref.image_item?.media?.encrypt_query_param) {
          const aesKey = ref.image_item.aeskey ? Buffer.from(ref.image_item.aeskey, "hex").toString("base64") : ref.image_item.media.aes_key;
          mediaItems.push({
            type: MessageItemType.IMAGE,
            encryptQueryParam: ref.image_item.media.encrypt_query_param,
            aesKey: aesKey || undefined
          });
        } else if (ref.type === MessageItemType.VOICE && ref.voice_item?.media?.encrypt_query_param && ref.voice_item.media.aes_key) {
          mediaItems.push({
            type: MessageItemType.VOICE,
            encryptQueryParam: ref.voice_item.media.encrypt_query_param,
            aesKey: ref.voice_item.media.aes_key
          });
        } else if (ref.type === MessageItemType.FILE && ref.file_item?.media?.encrypt_query_param && ref.file_item.media.aes_key) {
          mediaItems.push({
            type: MessageItemType.FILE,
            encryptQueryParam: ref.file_item.media.encrypt_query_param,
            aesKey: ref.file_item.media.aes_key,
            fileName: ref.file_item.file_name
          });
        }
      }
      if (item.ref_msg?.message_item) {
        const ref = item.ref_msg.message_item;
        if (ref.type === MessageItemType.TEXT && ref.text_item?.text) {
          parts.unshift(`[引用] ${ref.text_item.text}`);
        } else if (ref.type === MessageItemType.VOICE && ref.voice_item?.text) {
          parts.unshift(`[引用] ${ref.voice_item.text}`);
        }
      }
    }
  }
  return {
    text: parts.join(`
`).trim(),
    imageUrls,
    mediaItems
  };
}
function markdownToPlainText(text) {
  let result = text;
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim());
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner) => inner.split("|").map((cell) => cell.trim()).join("  "));
  result = result.replace(/(\*\*|__)(.*?)\1/g, "$2");
  result = result.replace(/(\*|_)(.*?)\1/g, "$2");
  result = result.replace(/`([^`]+)`/g, "$1");
  return result;
}
function pcmBytesToWav(pcm, sampleRate) {
  const pcmBytes = pcm.byteLength;
  const totalSize = 44 + pcmBytes;
  const buf = Buffer.allocUnsafe(totalSize);
  let offset = 0;
  buf.write("RIFF", offset);
  offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buf.write("WAVE", offset);
  offset += 4;
  buf.write("fmt ", offset);
  offset += 4;
  buf.writeUInt32LE(16, offset);
  offset += 4;
  buf.writeUInt16LE(1, offset);
  offset += 2;
  buf.writeUInt16LE(1, offset);
  offset += 2;
  buf.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buf.writeUInt32LE(sampleRate * 2, offset);
  offset += 4;
  buf.writeUInt16LE(2, offset);
  offset += 2;
  buf.writeUInt16LE(16, offset);
  offset += 2;
  buf.write("data", offset);
  offset += 4;
  buf.writeUInt32LE(pcmBytes, offset);
  offset += 4;
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);
  return buf;
}
var createWeixinPlatform = definePlatformFactory({
  platformName: "weixin",
  resolveConfig: (raw, context) => ({
    botToken: raw.botToken,
    baseUrl: raw.baseUrl,
    showToolStatus: raw.showToolStatus,
    configDir: context.configDir
  }),
  create: (backend, config) => new WeixinPlatform(backend, config)
});
var platform = createWeixinPlatform;
var src_default = platform;
export {
  src_default as default,
  createWeixinPlatform,
  WeixinPlatform
};
