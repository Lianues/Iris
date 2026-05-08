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

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS((exports) => {
  var ALIAS = Symbol.for("yaml.alias");
  var DOC = Symbol.for("yaml.document");
  var MAP = Symbol.for("yaml.map");
  var PAIR = Symbol.for("yaml.pair");
  var SCALAR = Symbol.for("yaml.scalar");
  var SEQ = Symbol.for("yaml.seq");
  var NODE_TYPE = Symbol.for("yaml.node.type");
  var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
  var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
  var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
  var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
  var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
  var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
  function isCollection(node) {
    if (node && typeof node === "object")
      switch (node[NODE_TYPE]) {
        case MAP:
        case SEQ:
          return true;
      }
    return false;
  }
  function isNode(node) {
    if (node && typeof node === "object")
      switch (node[NODE_TYPE]) {
        case ALIAS:
        case MAP:
        case SCALAR:
        case SEQ:
          return true;
      }
    return false;
  }
  var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
  exports.ALIAS = ALIAS;
  exports.DOC = DOC;
  exports.MAP = MAP;
  exports.NODE_TYPE = NODE_TYPE;
  exports.PAIR = PAIR;
  exports.SCALAR = SCALAR;
  exports.SEQ = SEQ;
  exports.hasAnchor = hasAnchor;
  exports.isAlias = isAlias;
  exports.isCollection = isCollection;
  exports.isDocument = isDocument;
  exports.isMap = isMap;
  exports.isNode = isNode;
  exports.isPair = isPair;
  exports.isScalar = isScalar;
  exports.isSeq = isSeq;
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS((exports) => {
  var identity = require_identity();
  var BREAK = Symbol("break visit");
  var SKIP = Symbol("skip children");
  var REMOVE = Symbol("remove node");
  function visit(node, visitor) {
    const visitor_ = initVisitor(visitor);
    if (identity.isDocument(node)) {
      const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
      if (cd === REMOVE)
        node.contents = null;
    } else
      visit_(null, node, visitor_, Object.freeze([]));
  }
  visit.BREAK = BREAK;
  visit.SKIP = SKIP;
  visit.REMOVE = REMOVE;
  function visit_(key, node, visitor, path) {
    const ctrl = callVisitor(key, node, visitor, path);
    if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
      replaceNode(key, path, ctrl);
      return visit_(key, ctrl, visitor, path);
    }
    if (typeof ctrl !== "symbol") {
      if (identity.isCollection(node)) {
        path = Object.freeze(path.concat(node));
        for (let i = 0;i < node.items.length; ++i) {
          const ci = visit_(i, node.items[i], visitor, path);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK)
            return BREAK;
          else if (ci === REMOVE) {
            node.items.splice(i, 1);
            i -= 1;
          }
        }
      } else if (identity.isPair(node)) {
        path = Object.freeze(path.concat(node));
        const ck = visit_("key", node.key, visitor, path);
        if (ck === BREAK)
          return BREAK;
        else if (ck === REMOVE)
          node.key = null;
        const cv = visit_("value", node.value, visitor, path);
        if (cv === BREAK)
          return BREAK;
        else if (cv === REMOVE)
          node.value = null;
      }
    }
    return ctrl;
  }
  async function visitAsync(node, visitor) {
    const visitor_ = initVisitor(visitor);
    if (identity.isDocument(node)) {
      const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
      if (cd === REMOVE)
        node.contents = null;
    } else
      await visitAsync_(null, node, visitor_, Object.freeze([]));
  }
  visitAsync.BREAK = BREAK;
  visitAsync.SKIP = SKIP;
  visitAsync.REMOVE = REMOVE;
  async function visitAsync_(key, node, visitor, path) {
    const ctrl = await callVisitor(key, node, visitor, path);
    if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
      replaceNode(key, path, ctrl);
      return visitAsync_(key, ctrl, visitor, path);
    }
    if (typeof ctrl !== "symbol") {
      if (identity.isCollection(node)) {
        path = Object.freeze(path.concat(node));
        for (let i = 0;i < node.items.length; ++i) {
          const ci = await visitAsync_(i, node.items[i], visitor, path);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK)
            return BREAK;
          else if (ci === REMOVE) {
            node.items.splice(i, 1);
            i -= 1;
          }
        }
      } else if (identity.isPair(node)) {
        path = Object.freeze(path.concat(node));
        const ck = await visitAsync_("key", node.key, visitor, path);
        if (ck === BREAK)
          return BREAK;
        else if (ck === REMOVE)
          node.key = null;
        const cv = await visitAsync_("value", node.value, visitor, path);
        if (cv === BREAK)
          return BREAK;
        else if (cv === REMOVE)
          node.value = null;
      }
    }
    return ctrl;
  }
  function initVisitor(visitor) {
    if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
      return Object.assign({
        Alias: visitor.Node,
        Map: visitor.Node,
        Scalar: visitor.Node,
        Seq: visitor.Node
      }, visitor.Value && {
        Map: visitor.Value,
        Scalar: visitor.Value,
        Seq: visitor.Value
      }, visitor.Collection && {
        Map: visitor.Collection,
        Seq: visitor.Collection
      }, visitor);
    }
    return visitor;
  }
  function callVisitor(key, node, visitor, path) {
    if (typeof visitor === "function")
      return visitor(key, node, path);
    if (identity.isMap(node))
      return visitor.Map?.(key, node, path);
    if (identity.isSeq(node))
      return visitor.Seq?.(key, node, path);
    if (identity.isPair(node))
      return visitor.Pair?.(key, node, path);
    if (identity.isScalar(node))
      return visitor.Scalar?.(key, node, path);
    if (identity.isAlias(node))
      return visitor.Alias?.(key, node, path);
    return;
  }
  function replaceNode(key, path, node) {
    const parent = path[path.length - 1];
    if (identity.isCollection(parent)) {
      parent.items[key] = node;
    } else if (identity.isPair(parent)) {
      if (key === "key")
        parent.key = node;
      else
        parent.value = node;
    } else if (identity.isDocument(parent)) {
      parent.contents = node;
    } else {
      const pt = identity.isAlias(parent) ? "alias" : "scalar";
      throw new Error(`Cannot replace node with ${pt} parent`);
    }
  }
  exports.visit = visit;
  exports.visitAsync = visitAsync;
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS((exports) => {
  var identity = require_identity();
  var visit = require_visit();
  var escapeChars = {
    "!": "%21",
    ",": "%2C",
    "[": "%5B",
    "]": "%5D",
    "{": "%7B",
    "}": "%7D"
  };
  var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);

  class Directives {
    constructor(yaml, tags) {
      this.docStart = null;
      this.docEnd = false;
      this.yaml = Object.assign({}, Directives.defaultYaml, yaml);
      this.tags = Object.assign({}, Directives.defaultTags, tags);
    }
    clone() {
      const copy = new Directives(this.yaml, this.tags);
      copy.docStart = this.docStart;
      return copy;
    }
    atDocument() {
      const res = new Directives(this.yaml, this.tags);
      switch (this.yaml.version) {
        case "1.1":
          this.atNextDocument = true;
          break;
        case "1.2":
          this.atNextDocument = false;
          this.yaml = {
            explicit: Directives.defaultYaml.explicit,
            version: "1.2"
          };
          this.tags = Object.assign({}, Directives.defaultTags);
          break;
      }
      return res;
    }
    add(line, onError) {
      if (this.atNextDocument) {
        this.yaml = { explicit: Directives.defaultYaml.explicit, version: "1.1" };
        this.tags = Object.assign({}, Directives.defaultTags);
        this.atNextDocument = false;
      }
      const parts = line.trim().split(/[ \t]+/);
      const name = parts.shift();
      switch (name) {
        case "%TAG": {
          if (parts.length !== 2) {
            onError(0, "%TAG directive should contain exactly two parts");
            if (parts.length < 2)
              return false;
          }
          const [handle, prefix] = parts;
          this.tags[handle] = prefix;
          return true;
        }
        case "%YAML": {
          this.yaml.explicit = true;
          if (parts.length !== 1) {
            onError(0, "%YAML directive should contain exactly one part");
            return false;
          }
          const [version] = parts;
          if (version === "1.1" || version === "1.2") {
            this.yaml.version = version;
            return true;
          } else {
            const isValid = /^\d+\.\d+$/.test(version);
            onError(6, `Unsupported YAML version ${version}`, isValid);
            return false;
          }
        }
        default:
          onError(0, `Unknown directive ${name}`, true);
          return false;
      }
    }
    tagName(source, onError) {
      if (source === "!")
        return "!";
      if (source[0] !== "!") {
        onError(`Not a valid tag: ${source}`);
        return null;
      }
      if (source[1] === "<") {
        const verbatim = source.slice(2, -1);
        if (verbatim === "!" || verbatim === "!!") {
          onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
          return null;
        }
        if (source[source.length - 1] !== ">")
          onError("Verbatim tags must end with a >");
        return verbatim;
      }
      const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
      if (!suffix)
        onError(`The ${source} tag has no suffix`);
      const prefix = this.tags[handle];
      if (prefix) {
        try {
          return prefix + decodeURIComponent(suffix);
        } catch (error) {
          onError(String(error));
          return null;
        }
      }
      if (handle === "!")
        return source;
      onError(`Could not resolve tag: ${source}`);
      return null;
    }
    tagString(tag) {
      for (const [handle, prefix] of Object.entries(this.tags)) {
        if (tag.startsWith(prefix))
          return handle + escapeTagName(tag.substring(prefix.length));
      }
      return tag[0] === "!" ? tag : `!<${tag}>`;
    }
    toString(doc) {
      const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
      const tagEntries = Object.entries(this.tags);
      let tagNames;
      if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
        const tags = {};
        visit.visit(doc.contents, (_key, node) => {
          if (identity.isNode(node) && node.tag)
            tags[node.tag] = true;
        });
        tagNames = Object.keys(tags);
      } else
        tagNames = [];
      for (const [handle, prefix] of tagEntries) {
        if (handle === "!!" && prefix === "tag:yaml.org,2002:")
          continue;
        if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
          lines.push(`%TAG ${handle} ${prefix}`);
      }
      return lines.join(`
`);
    }
  }
  Directives.defaultYaml = { explicit: false, version: "1.2" };
  Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
  exports.Directives = Directives;
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS((exports) => {
  var identity = require_identity();
  var visit = require_visit();
  function anchorIsValid(anchor) {
    if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
      const sa = JSON.stringify(anchor);
      const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
      throw new Error(msg);
    }
    return true;
  }
  function anchorNames(root) {
    const anchors = new Set;
    visit.visit(root, {
      Value(_key, node) {
        if (node.anchor)
          anchors.add(node.anchor);
      }
    });
    return anchors;
  }
  function findNewAnchor(prefix, exclude) {
    for (let i = 1;; ++i) {
      const name = `${prefix}${i}`;
      if (!exclude.has(name))
        return name;
    }
  }
  function createNodeAnchors(doc, prefix) {
    const aliasObjects = [];
    const sourceObjects = new Map;
    let prevAnchors = null;
    return {
      onAnchor: (source) => {
        aliasObjects.push(source);
        prevAnchors ?? (prevAnchors = anchorNames(doc));
        const anchor = findNewAnchor(prefix, prevAnchors);
        prevAnchors.add(anchor);
        return anchor;
      },
      setAnchors: () => {
        for (const source of aliasObjects) {
          const ref = sourceObjects.get(source);
          if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
            ref.node.anchor = ref.anchor;
          } else {
            const error = new Error("Failed to resolve repeated object (this should not happen)");
            error.source = source;
            throw error;
          }
        }
      },
      sourceObjects
    };
  }
  exports.anchorIsValid = anchorIsValid;
  exports.anchorNames = anchorNames;
  exports.createNodeAnchors = createNodeAnchors;
  exports.findNewAnchor = findNewAnchor;
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS((exports) => {
  function applyReviver(reviver, obj, key, val) {
    if (val && typeof val === "object") {
      if (Array.isArray(val)) {
        for (let i = 0, len = val.length;i < len; ++i) {
          const v0 = val[i];
          const v1 = applyReviver(reviver, val, String(i), v0);
          if (v1 === undefined)
            delete val[i];
          else if (v1 !== v0)
            val[i] = v1;
        }
      } else if (val instanceof Map) {
        for (const k of Array.from(val.keys())) {
          const v0 = val.get(k);
          const v1 = applyReviver(reviver, val, k, v0);
          if (v1 === undefined)
            val.delete(k);
          else if (v1 !== v0)
            val.set(k, v1);
        }
      } else if (val instanceof Set) {
        for (const v0 of Array.from(val)) {
          const v1 = applyReviver(reviver, val, v0, v0);
          if (v1 === undefined)
            val.delete(v0);
          else if (v1 !== v0) {
            val.delete(v0);
            val.add(v1);
          }
        }
      } else {
        for (const [k, v0] of Object.entries(val)) {
          const v1 = applyReviver(reviver, val, k, v0);
          if (v1 === undefined)
            delete val[k];
          else if (v1 !== v0)
            val[k] = v1;
        }
      }
    }
    return reviver.call(obj, key, val);
  }
  exports.applyReviver = applyReviver;
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS((exports) => {
  var identity = require_identity();
  function toJS(value, arg, ctx) {
    if (Array.isArray(value))
      return value.map((v, i) => toJS(v, String(i), ctx));
    if (value && typeof value.toJSON === "function") {
      if (!ctx || !identity.hasAnchor(value))
        return value.toJSON(arg, ctx);
      const data = { aliasCount: 0, count: 1, res: undefined };
      ctx.anchors.set(value, data);
      ctx.onCreate = (res2) => {
        data.res = res2;
        delete ctx.onCreate;
      };
      const res = value.toJSON(arg, ctx);
      if (ctx.onCreate)
        ctx.onCreate(res);
      return res;
    }
    if (typeof value === "bigint" && !ctx?.keep)
      return Number(value);
    return value;
  }
  exports.toJS = toJS;
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS((exports) => {
  var applyReviver = require_applyReviver();
  var identity = require_identity();
  var toJS = require_toJS();

  class NodeBase {
    constructor(type) {
      Object.defineProperty(this, identity.NODE_TYPE, { value: type });
    }
    clone() {
      const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
      if (!identity.isDocument(doc))
        throw new TypeError("A document argument is required");
      const ctx = {
        anchors: new Map,
        doc,
        keep: true,
        mapAsMap: mapAsMap === true,
        mapKeyWarned: false,
        maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
      };
      const res = toJS.toJS(this, "", ctx);
      if (typeof onAnchor === "function")
        for (const { count, res: res2 } of ctx.anchors.values())
          onAnchor(res2, count);
      return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
    }
  }
  exports.NodeBase = NodeBase;
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS((exports) => {
  var anchors = require_anchors();
  var visit = require_visit();
  var identity = require_identity();
  var Node = require_Node();
  var toJS = require_toJS();

  class Alias extends Node.NodeBase {
    constructor(source) {
      super(identity.ALIAS);
      this.source = source;
      Object.defineProperty(this, "tag", {
        set() {
          throw new Error("Alias nodes cannot have tags");
        }
      });
    }
    resolve(doc, ctx) {
      if (ctx?.maxAliasCount === 0)
        throw new ReferenceError("Alias resolution is disabled");
      let nodes;
      if (ctx?.aliasResolveCache) {
        nodes = ctx.aliasResolveCache;
      } else {
        nodes = [];
        visit.visit(doc, {
          Node: (_key, node) => {
            if (identity.isAlias(node) || identity.hasAnchor(node))
              nodes.push(node);
          }
        });
        if (ctx)
          ctx.aliasResolveCache = nodes;
      }
      let found = undefined;
      for (const node of nodes) {
        if (node === this)
          break;
        if (node.anchor === this.source)
          found = node;
      }
      return found;
    }
    toJSON(_arg, ctx) {
      if (!ctx)
        return { source: this.source };
      const { anchors: anchors2, doc, maxAliasCount } = ctx;
      const source = this.resolve(doc, ctx);
      if (!source) {
        const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
        throw new ReferenceError(msg);
      }
      let data = anchors2.get(source);
      if (!data) {
        toJS.toJS(source, null, ctx);
        data = anchors2.get(source);
      }
      if (data?.res === undefined) {
        const msg = "This should not happen: Alias anchor was not resolved?";
        throw new ReferenceError(msg);
      }
      if (maxAliasCount >= 0) {
        data.count += 1;
        if (data.aliasCount === 0)
          data.aliasCount = getAliasCount(doc, source, anchors2);
        if (data.count * data.aliasCount > maxAliasCount) {
          const msg = "Excessive alias count indicates a resource exhaustion attack";
          throw new ReferenceError(msg);
        }
      }
      return data.res;
    }
    toString(ctx, _onComment, _onChompKeep) {
      const src = `*${this.source}`;
      if (ctx) {
        anchors.anchorIsValid(this.source);
        if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new Error(msg);
        }
        if (ctx.implicitKey)
          return `${src} `;
      }
      return src;
    }
  }
  function getAliasCount(doc, node, anchors2) {
    if (identity.isAlias(node)) {
      const source = node.resolve(doc);
      const anchor = anchors2 && source && anchors2.get(source);
      return anchor ? anchor.count * anchor.aliasCount : 0;
    } else if (identity.isCollection(node)) {
      let count = 0;
      for (const item of node.items) {
        const c = getAliasCount(doc, item, anchors2);
        if (c > count)
          count = c;
      }
      return count;
    } else if (identity.isPair(node)) {
      const kc = getAliasCount(doc, node.key, anchors2);
      const vc = getAliasCount(doc, node.value, anchors2);
      return Math.max(kc, vc);
    }
    return 1;
  }
  exports.Alias = Alias;
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS((exports) => {
  var identity = require_identity();
  var Node = require_Node();
  var toJS = require_toJS();
  var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";

  class Scalar extends Node.NodeBase {
    constructor(value) {
      super(identity.SCALAR);
      this.value = value;
    }
    toJSON(arg, ctx) {
      return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
    }
    toString() {
      return String(this.value);
    }
  }
  Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
  Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
  Scalar.PLAIN = "PLAIN";
  Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
  Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
  exports.Scalar = Scalar;
  exports.isScalarValue = isScalarValue;
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS((exports) => {
  var Alias = require_Alias();
  var identity = require_identity();
  var Scalar = require_Scalar();
  var defaultTagPrefix = "tag:yaml.org,2002:";
  function findTagObject(value, tagName, tags) {
    if (tagName) {
      const match = tags.filter((t) => t.tag === tagName);
      const tagObj = match.find((t) => !t.format) ?? match[0];
      if (!tagObj)
        throw new Error(`Tag ${tagName} not found`);
      return tagObj;
    }
    return tags.find((t) => t.identify?.(value) && !t.format);
  }
  function createNode(value, tagName, ctx) {
    if (identity.isDocument(value))
      value = value.contents;
    if (identity.isNode(value))
      return value;
    if (identity.isPair(value)) {
      const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
      map.items.push(value);
      return map;
    }
    if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
      value = value.valueOf();
    }
    const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
    let ref = undefined;
    if (aliasDuplicateObjects && value && typeof value === "object") {
      ref = sourceObjects.get(value);
      if (ref) {
        ref.anchor ?? (ref.anchor = onAnchor(value));
        return new Alias.Alias(ref.anchor);
      } else {
        ref = { anchor: null, node: null };
        sourceObjects.set(value, ref);
      }
    }
    if (tagName?.startsWith("!!"))
      tagName = defaultTagPrefix + tagName.slice(2);
    let tagObj = findTagObject(value, tagName, schema.tags);
    if (!tagObj) {
      if (value && typeof value.toJSON === "function") {
        value = value.toJSON();
      }
      if (!value || typeof value !== "object") {
        const node2 = new Scalar.Scalar(value);
        if (ref)
          ref.node = node2;
        return node2;
      }
      tagObj = value instanceof Map ? schema[identity.MAP] : (Symbol.iterator in Object(value)) ? schema[identity.SEQ] : schema[identity.MAP];
    }
    if (onTagObj) {
      onTagObj(tagObj);
      delete ctx.onTagObj;
    }
    const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
    if (tagName)
      node.tag = tagName;
    else if (!tagObj.default)
      node.tag = tagObj.tag;
    if (ref)
      ref.node = node;
    return node;
  }
  exports.createNode = createNode;
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS((exports) => {
  var createNode = require_createNode();
  var identity = require_identity();
  var Node = require_Node();
  function collectionFromPath(schema, path, value) {
    let v = value;
    for (let i = path.length - 1;i >= 0; --i) {
      const k = path[i];
      if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
        const a = [];
        a[k] = v;
        v = a;
      } else {
        v = new Map([[k, v]]);
      }
    }
    return createNode.createNode(v, undefined, {
      aliasDuplicateObjects: false,
      keepUndefined: false,
      onAnchor: () => {
        throw new Error("This should not happen, please report a bug.");
      },
      schema,
      sourceObjects: new Map
    });
  }
  var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;

  class Collection extends Node.NodeBase {
    constructor(type, schema) {
      super(type);
      Object.defineProperty(this, "schema", {
        value: schema,
        configurable: true,
        enumerable: false,
        writable: true
      });
    }
    clone(schema) {
      const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
      if (schema)
        copy.schema = schema;
      copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    addIn(path, value) {
      if (isEmptyPath(path))
        this.add(value);
      else {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (identity.isCollection(node))
          node.addIn(rest, value);
        else if (node === undefined && this.schema)
          this.set(key, collectionFromPath(this.schema, rest, value));
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
    }
    deleteIn(path) {
      const [key, ...rest] = path;
      if (rest.length === 0)
        return this.delete(key);
      const node = this.get(key, true);
      if (identity.isCollection(node))
        return node.deleteIn(rest);
      else
        throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
    }
    getIn(path, keepScalar) {
      const [key, ...rest] = path;
      const node = this.get(key, true);
      if (rest.length === 0)
        return !keepScalar && identity.isScalar(node) ? node.value : node;
      else
        return identity.isCollection(node) ? node.getIn(rest, keepScalar) : undefined;
    }
    hasAllNullValues(allowScalar) {
      return this.items.every((node) => {
        if (!identity.isPair(node))
          return false;
        const n = node.value;
        return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
      });
    }
    hasIn(path) {
      const [key, ...rest] = path;
      if (rest.length === 0)
        return this.has(key);
      const node = this.get(key, true);
      return identity.isCollection(node) ? node.hasIn(rest) : false;
    }
    setIn(path, value) {
      const [key, ...rest] = path;
      if (rest.length === 0) {
        this.set(key, value);
      } else {
        const node = this.get(key, true);
        if (identity.isCollection(node))
          node.setIn(rest, value);
        else if (node === undefined && this.schema)
          this.set(key, collectionFromPath(this.schema, rest, value));
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
    }
  }
  exports.Collection = Collection;
  exports.collectionFromPath = collectionFromPath;
  exports.isEmptyPath = isEmptyPath;
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS((exports) => {
  var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
  function indentComment(comment, indent) {
    if (/^\n+$/.test(comment))
      return comment.substring(1);
    return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
  }
  var lineComment = (str, indent, comment) => str.endsWith(`
`) ? indentComment(comment, indent) : comment.includes(`
`) ? `
` + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
  exports.indentComment = indentComment;
  exports.lineComment = lineComment;
  exports.stringifyComment = stringifyComment;
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS((exports) => {
  var FOLD_FLOW = "flow";
  var FOLD_BLOCK = "block";
  var FOLD_QUOTED = "quoted";
  function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
    if (!lineWidth || lineWidth < 0)
      return text;
    if (lineWidth < minContentWidth)
      minContentWidth = 0;
    const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
    if (text.length <= endStep)
      return text;
    const folds = [];
    const escapedFolds = {};
    let end = lineWidth - indent.length;
    if (typeof indentAtStart === "number") {
      if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
        folds.push(0);
      else
        end = lineWidth - indentAtStart;
    }
    let split = undefined;
    let prev = undefined;
    let overflow = false;
    let i = -1;
    let escStart = -1;
    let escEnd = -1;
    if (mode === FOLD_BLOCK) {
      i = consumeMoreIndentedLines(text, i, indent.length);
      if (i !== -1)
        end = i + endStep;
    }
    for (let ch;ch = text[i += 1]; ) {
      if (mode === FOLD_QUOTED && ch === "\\") {
        escStart = i;
        switch (text[i + 1]) {
          case "x":
            i += 3;
            break;
          case "u":
            i += 5;
            break;
          case "U":
            i += 9;
            break;
          default:
            i += 1;
        }
        escEnd = i;
      }
      if (ch === `
`) {
        if (mode === FOLD_BLOCK)
          i = consumeMoreIndentedLines(text, i, indent.length);
        end = i + indent.length + endStep;
        split = undefined;
      } else {
        if (ch === " " && prev && prev !== " " && prev !== `
` && prev !== "\t") {
          const next = text[i + 1];
          if (next && next !== " " && next !== `
` && next !== "\t")
            split = i;
        }
        if (i >= end) {
          if (split) {
            folds.push(split);
            end = split + endStep;
            split = undefined;
          } else if (mode === FOLD_QUOTED) {
            while (prev === " " || prev === "\t") {
              prev = ch;
              ch = text[i += 1];
              overflow = true;
            }
            const j = i > escEnd + 1 ? i - 2 : escStart - 1;
            if (escapedFolds[j])
              return text;
            folds.push(j);
            escapedFolds[j] = true;
            end = j + endStep;
            split = undefined;
          } else {
            overflow = true;
          }
        }
      }
      prev = ch;
    }
    if (overflow && onOverflow)
      onOverflow();
    if (folds.length === 0)
      return text;
    if (onFold)
      onFold();
    let res = text.slice(0, folds[0]);
    for (let i2 = 0;i2 < folds.length; ++i2) {
      const fold = folds[i2];
      const end2 = folds[i2 + 1] || text.length;
      if (fold === 0)
        res = `
${indent}${text.slice(0, end2)}`;
      else {
        if (mode === FOLD_QUOTED && escapedFolds[fold])
          res += `${text[fold]}\\`;
        res += `
${indent}${text.slice(fold + 1, end2)}`;
      }
    }
    return res;
  }
  function consumeMoreIndentedLines(text, i, indent) {
    let end = i;
    let start = i + 1;
    let ch = text[start];
    while (ch === " " || ch === "\t") {
      if (i < start + indent) {
        ch = text[++i];
      } else {
        do {
          ch = text[++i];
        } while (ch && ch !== `
`);
        end = i;
        start = i + 1;
        ch = text[start];
      }
    }
    return end;
  }
  exports.FOLD_BLOCK = FOLD_BLOCK;
  exports.FOLD_FLOW = FOLD_FLOW;
  exports.FOLD_QUOTED = FOLD_QUOTED;
  exports.foldFlowLines = foldFlowLines;
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS((exports) => {
  var Scalar = require_Scalar();
  var foldFlowLines = require_foldFlowLines();
  var getFoldOptions = (ctx, isBlock) => ({
    indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
    lineWidth: ctx.options.lineWidth,
    minContentWidth: ctx.options.minContentWidth
  });
  var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
  function lineLengthOverLimit(str, lineWidth, indentLength) {
    if (!lineWidth || lineWidth < 0)
      return false;
    const limit = lineWidth - indentLength;
    const strLen = str.length;
    if (strLen <= limit)
      return false;
    for (let i = 0, start = 0;i < strLen; ++i) {
      if (str[i] === `
`) {
        if (i - start > limit)
          return true;
        start = i + 1;
        if (strLen - start <= limit)
          return false;
      }
    }
    return true;
  }
  function doubleQuotedString(value, ctx) {
    const json = JSON.stringify(value);
    if (ctx.options.doubleQuotedAsJSON)
      return json;
    const { implicitKey } = ctx;
    const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
    const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
    let str = "";
    let start = 0;
    for (let i = 0, ch = json[i];ch; ch = json[++i]) {
      if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
        str += json.slice(start, i) + "\\ ";
        i += 1;
        start = i;
        ch = "\\";
      }
      if (ch === "\\")
        switch (json[i + 1]) {
          case "u":
            {
              str += json.slice(start, i);
              const code = json.substr(i + 2, 4);
              switch (code) {
                case "0000":
                  str += "\\0";
                  break;
                case "0007":
                  str += "\\a";
                  break;
                case "000b":
                  str += "\\v";
                  break;
                case "001b":
                  str += "\\e";
                  break;
                case "0085":
                  str += "\\N";
                  break;
                case "00a0":
                  str += "\\_";
                  break;
                case "2028":
                  str += "\\L";
                  break;
                case "2029":
                  str += "\\P";
                  break;
                default:
                  if (code.substr(0, 2) === "00")
                    str += "\\x" + code.substr(2);
                  else
                    str += json.substr(i, 6);
              }
              i += 5;
              start = i + 1;
            }
            break;
          case "n":
            if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
              i += 1;
            } else {
              str += json.slice(start, i) + `

`;
              while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                str += `
`;
                i += 2;
              }
              str += indent;
              if (json[i + 2] === " ")
                str += "\\";
              i += 1;
              start = i + 1;
            }
            break;
          default:
            i += 1;
        }
    }
    str = start ? str + json.slice(start) : json;
    return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
  }
  function singleQuotedString(value, ctx) {
    if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes(`
`) || /[ \t]\n|\n[ \t]/.test(value))
      return doubleQuotedString(value, ctx);
    const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
    const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
    return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
  }
  function quotedString(value, ctx) {
    const { singleQuote } = ctx.options;
    let qs;
    if (singleQuote === false)
      qs = doubleQuotedString;
    else {
      const hasDouble = value.includes('"');
      const hasSingle = value.includes("'");
      if (hasDouble && !hasSingle)
        qs = singleQuotedString;
      else if (hasSingle && !hasDouble)
        qs = doubleQuotedString;
      else
        qs = singleQuote ? singleQuotedString : doubleQuotedString;
    }
    return qs(value, ctx);
  }
  var blockEndNewlines;
  try {
    blockEndNewlines = new RegExp(`(^|(?<!
))
+(?!
|$)`, "g");
  } catch {
    blockEndNewlines = /\n+(?!\n|$)/g;
  }
  function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
    const { blockQuote, commentString, lineWidth } = ctx.options;
    if (!blockQuote || /\n[\t ]+$/.test(value)) {
      return quotedString(value, ctx);
    }
    const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
    const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
    if (!value)
      return literal ? `|
` : `>
`;
    let chomp;
    let endStart;
    for (endStart = value.length;endStart > 0; --endStart) {
      const ch = value[endStart - 1];
      if (ch !== `
` && ch !== "\t" && ch !== " ")
        break;
    }
    let end = value.substring(endStart);
    const endNlPos = end.indexOf(`
`);
    if (endNlPos === -1) {
      chomp = "-";
    } else if (value === end || endNlPos !== end.length - 1) {
      chomp = "+";
      if (onChompKeep)
        onChompKeep();
    } else {
      chomp = "";
    }
    if (end) {
      value = value.slice(0, -end.length);
      if (end[end.length - 1] === `
`)
        end = end.slice(0, -1);
      end = end.replace(blockEndNewlines, `$&${indent}`);
    }
    let startWithSpace = false;
    let startEnd;
    let startNlPos = -1;
    for (startEnd = 0;startEnd < value.length; ++startEnd) {
      const ch = value[startEnd];
      if (ch === " ")
        startWithSpace = true;
      else if (ch === `
`)
        startNlPos = startEnd;
      else
        break;
    }
    let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
    if (start) {
      value = value.substring(start.length);
      start = start.replace(/\n+/g, `$&${indent}`);
    }
    const indentSize = indent ? "2" : "1";
    let header = (startWithSpace ? indentSize : "") + chomp;
    if (comment) {
      header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
      if (onComment)
        onComment();
    }
    if (!literal) {
      const foldedValue = value.replace(/\n+/g, `
$&`).replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
      let literalFallback = false;
      const foldOptions = getFoldOptions(ctx, true);
      if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
        foldOptions.onOverflow = () => {
          literalFallback = true;
        };
      }
      const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
      if (!literalFallback)
        return `>${header}
${indent}${body}`;
    }
    value = value.replace(/\n+/g, `$&${indent}`);
    return `|${header}
${indent}${start}${value}${end}`;
  }
  function plainString(item, ctx, onComment, onChompKeep) {
    const { type, value } = item;
    const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
    if (implicitKey && value.includes(`
`) || inFlow && /[[\]{},]/.test(value)) {
      return quotedString(value, ctx);
    }
    if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
      return implicitKey || inFlow || !value.includes(`
`) ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
    }
    if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes(`
`)) {
      return blockString(item, ctx, onComment, onChompKeep);
    }
    if (containsDocumentMarker(value)) {
      if (indent === "") {
        ctx.forceBlockIndent = true;
        return blockString(item, ctx, onComment, onChompKeep);
      } else if (implicitKey && indent === indentStep) {
        return quotedString(value, ctx);
      }
    }
    const str = value.replace(/\n+/g, `$&
${indent}`);
    if (actualString) {
      const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
      const { compat, tags } = ctx.doc.schema;
      if (tags.some(test) || compat?.some(test))
        return quotedString(value, ctx);
    }
    return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
  }
  function stringifyString(item, ctx, onComment, onChompKeep) {
    const { implicitKey, inFlow } = ctx;
    const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
    let { type } = item;
    if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
      if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
        type = Scalar.Scalar.QUOTE_DOUBLE;
    }
    const _stringify = (_type) => {
      switch (_type) {
        case Scalar.Scalar.BLOCK_FOLDED:
        case Scalar.Scalar.BLOCK_LITERAL:
          return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
        case Scalar.Scalar.QUOTE_DOUBLE:
          return doubleQuotedString(ss.value, ctx);
        case Scalar.Scalar.QUOTE_SINGLE:
          return singleQuotedString(ss.value, ctx);
        case Scalar.Scalar.PLAIN:
          return plainString(ss, ctx, onComment, onChompKeep);
        default:
          return null;
      }
    };
    let res = _stringify(type);
    if (res === null) {
      const { defaultKeyType, defaultStringType } = ctx.options;
      const t = implicitKey && defaultKeyType || defaultStringType;
      res = _stringify(t);
      if (res === null)
        throw new Error(`Unsupported default string type ${t}`);
    }
    return res;
  }
  exports.stringifyString = stringifyString;
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS((exports) => {
  var anchors = require_anchors();
  var identity = require_identity();
  var stringifyComment = require_stringifyComment();
  var stringifyString = require_stringifyString();
  function createStringifyContext(doc, options) {
    const opt = Object.assign({
      blockQuote: true,
      commentString: stringifyComment.stringifyComment,
      defaultKeyType: null,
      defaultStringType: "PLAIN",
      directives: null,
      doubleQuotedAsJSON: false,
      doubleQuotedMinMultiLineLength: 40,
      falseStr: "false",
      flowCollectionPadding: true,
      indentSeq: true,
      lineWidth: 80,
      minContentWidth: 20,
      nullStr: "null",
      simpleKeys: false,
      singleQuote: null,
      trailingComma: false,
      trueStr: "true",
      verifyAliasOrder: true
    }, doc.schema.toStringOptions, options);
    let inFlow;
    switch (opt.collectionStyle) {
      case "block":
        inFlow = false;
        break;
      case "flow":
        inFlow = true;
        break;
      default:
        inFlow = null;
    }
    return {
      anchors: new Set,
      doc,
      flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
      indent: "",
      indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
      inFlow,
      options: opt
    };
  }
  function getTagObject(tags, item) {
    if (item.tag) {
      const match = tags.filter((t) => t.tag === item.tag);
      if (match.length > 0)
        return match.find((t) => t.format === item.format) ?? match[0];
    }
    let tagObj = undefined;
    let obj;
    if (identity.isScalar(item)) {
      obj = item.value;
      let match = tags.filter((t) => t.identify?.(obj));
      if (match.length > 1) {
        const testMatch = match.filter((t) => t.test);
        if (testMatch.length > 0)
          match = testMatch;
      }
      tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
    } else {
      obj = item;
      tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
    }
    if (!tagObj) {
      const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
      throw new Error(`Tag not resolved for ${name} value`);
    }
    return tagObj;
  }
  function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
    if (!doc.directives)
      return "";
    const props = [];
    const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
    if (anchor && anchors.anchorIsValid(anchor)) {
      anchors$1.add(anchor);
      props.push(`&${anchor}`);
    }
    const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
    if (tag)
      props.push(doc.directives.tagString(tag));
    return props.join(" ");
  }
  function stringify(item, ctx, onComment, onChompKeep) {
    if (identity.isPair(item))
      return item.toString(ctx, onComment, onChompKeep);
    if (identity.isAlias(item)) {
      if (ctx.doc.directives)
        return item.toString(ctx);
      if (ctx.resolvedAliases?.has(item)) {
        throw new TypeError(`Cannot stringify circular structure without alias nodes`);
      } else {
        if (ctx.resolvedAliases)
          ctx.resolvedAliases.add(item);
        else
          ctx.resolvedAliases = new Set([item]);
        item = item.resolve(ctx.doc);
      }
    }
    let tagObj = undefined;
    const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
    tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
    const props = stringifyProps(node, tagObj, ctx);
    if (props.length > 0)
      ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
    const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
    if (!props)
      return str;
    return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
  }
  exports.createStringifyContext = createStringifyContext;
  exports.stringify = stringify;
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS((exports) => {
  var identity = require_identity();
  var Scalar = require_Scalar();
  var stringify = require_stringify();
  var stringifyComment = require_stringifyComment();
  function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
    const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
    let keyComment = identity.isNode(key) && key.comment || null;
    if (simpleKeys) {
      if (keyComment) {
        throw new Error("With simple keys, key nodes cannot have comments");
      }
      if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
        const msg = "With simple keys, collection cannot be used as a key value";
        throw new Error(msg);
      }
    }
    let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
    ctx = Object.assign({}, ctx, {
      allNullValues: false,
      implicitKey: !explicitKey && (simpleKeys || !allNullValues),
      indent: indent + indentStep
    });
    let keyCommentDone = false;
    let chompKeep = false;
    let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
    if (!explicitKey && !ctx.inFlow && str.length > 1024) {
      if (simpleKeys)
        throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
      explicitKey = true;
    }
    if (ctx.inFlow) {
      if (allNullValues || value == null) {
        if (keyCommentDone && onComment)
          onComment();
        return str === "" ? "?" : explicitKey ? `? ${str}` : str;
      }
    } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
      str = `? ${str}`;
      if (keyComment && !keyCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    if (keyCommentDone)
      keyComment = null;
    if (explicitKey) {
      if (keyComment)
        str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      str = `? ${str}
${indent}:`;
    } else {
      str = `${str}:`;
      if (keyComment)
        str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
    }
    let vsb, vcb, valueComment;
    if (identity.isNode(value)) {
      vsb = !!value.spaceBefore;
      vcb = value.commentBefore;
      valueComment = value.comment;
    } else {
      vsb = false;
      vcb = null;
      valueComment = null;
      if (value && typeof value === "object")
        value = doc.createNode(value);
    }
    ctx.implicitKey = false;
    if (!explicitKey && !keyComment && identity.isScalar(value))
      ctx.indentAtStart = str.length + 1;
    chompKeep = false;
    if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
      ctx.indent = ctx.indent.substring(2);
    }
    let valueCommentDone = false;
    const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
    let ws = " ";
    if (keyComment || vsb || vcb) {
      ws = vsb ? `
` : "";
      if (vcb) {
        const cs = commentString(vcb);
        ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
      }
      if (valueStr === "" && !ctx.inFlow) {
        if (ws === `
` && valueComment)
          ws = `

`;
      } else {
        ws += `
${ctx.indent}`;
      }
    } else if (!explicitKey && identity.isCollection(value)) {
      const vs0 = valueStr[0];
      const nl0 = valueStr.indexOf(`
`);
      const hasNewline = nl0 !== -1;
      const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
      if (hasNewline || !flow) {
        let hasPropsLine = false;
        if (hasNewline && (vs0 === "&" || vs0 === "!")) {
          let sp0 = valueStr.indexOf(" ");
          if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
            sp0 = valueStr.indexOf(" ", sp0 + 1);
          }
          if (sp0 === -1 || nl0 < sp0)
            hasPropsLine = true;
        }
        if (!hasPropsLine)
          ws = `
${ctx.indent}`;
      }
    } else if (valueStr === "" || valueStr[0] === `
`) {
      ws = "";
    }
    str += ws + valueStr;
    if (ctx.inFlow) {
      if (valueCommentDone && onComment)
        onComment();
    } else if (valueComment && !valueCommentDone) {
      str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
    } else if (chompKeep && onChompKeep) {
      onChompKeep();
    }
    return str;
  }
  exports.stringifyPair = stringifyPair;
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS((exports) => {
  var node_process = __require("process");
  function debug(logLevel, ...messages) {
    if (logLevel === "debug")
      console.log(...messages);
  }
  function warn(logLevel, warning) {
    if (logLevel === "debug" || logLevel === "warn") {
      if (typeof node_process.emitWarning === "function")
        node_process.emitWarning(warning);
      else
        console.warn(warning);
    }
  }
  exports.debug = debug;
  exports.warn = warn;
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS((exports) => {
  var identity = require_identity();
  var Scalar = require_Scalar();
  var MERGE_KEY = "<<";
  var merge = {
    identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
    default: "key",
    tag: "tag:yaml.org,2002:merge",
    test: /^<<$/,
    resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
      addToJSMap: addMergeToJSMap
    }),
    stringify: () => MERGE_KEY
  };
  var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
  function addMergeToJSMap(ctx, map, value) {
    const source = resolveAliasValue(ctx, value);
    if (identity.isSeq(source))
      for (const it of source.items)
        mergeValue(ctx, map, it);
    else if (Array.isArray(source))
      for (const it of source)
        mergeValue(ctx, map, it);
    else
      mergeValue(ctx, map, source);
  }
  function mergeValue(ctx, map, value) {
    const source = resolveAliasValue(ctx, value);
    if (!identity.isMap(source))
      throw new Error("Merge sources must be maps or map aliases");
    const srcMap = source.toJSON(null, ctx, Map);
    for (const [key, value2] of srcMap) {
      if (map instanceof Map) {
        if (!map.has(key))
          map.set(key, value2);
      } else if (map instanceof Set) {
        map.add(key);
      } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
        Object.defineProperty(map, key, {
          value: value2,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    }
    return map;
  }
  function resolveAliasValue(ctx, value) {
    return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
  }
  exports.addMergeToJSMap = addMergeToJSMap;
  exports.isMergeKey = isMergeKey;
  exports.merge = merge;
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS((exports) => {
  var log = require_log();
  var merge = require_merge();
  var stringify = require_stringify();
  var identity = require_identity();
  var toJS = require_toJS();
  function addPairToJSMap(ctx, map, { key, value }) {
    if (identity.isNode(key) && key.addToJSMap)
      key.addToJSMap(ctx, map, value);
    else if (merge.isMergeKey(ctx, key))
      merge.addMergeToJSMap(ctx, map, value);
    else {
      const jsKey = toJS.toJS(key, "", ctx);
      if (map instanceof Map) {
        map.set(jsKey, toJS.toJS(value, jsKey, ctx));
      } else if (map instanceof Set) {
        map.add(jsKey);
      } else {
        const stringKey = stringifyKey(key, jsKey, ctx);
        const jsValue = toJS.toJS(value, stringKey, ctx);
        if (stringKey in map)
          Object.defineProperty(map, stringKey, {
            value: jsValue,
            writable: true,
            enumerable: true,
            configurable: true
          });
        else
          map[stringKey] = jsValue;
      }
    }
    return map;
  }
  function stringifyKey(key, jsKey, ctx) {
    if (jsKey === null)
      return "";
    if (typeof jsKey !== "object")
      return String(jsKey);
    if (identity.isNode(key) && ctx?.doc) {
      const strCtx = stringify.createStringifyContext(ctx.doc, {});
      strCtx.anchors = new Set;
      for (const node of ctx.anchors.keys())
        strCtx.anchors.add(node.anchor);
      strCtx.inFlow = true;
      strCtx.inStringifyKey = true;
      const strKey = key.toString(strCtx);
      if (!ctx.mapKeyWarned) {
        let jsonStr = JSON.stringify(strKey);
        if (jsonStr.length > 40)
          jsonStr = jsonStr.substring(0, 36) + '..."';
        log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
        ctx.mapKeyWarned = true;
      }
      return strKey;
    }
    return JSON.stringify(jsKey);
  }
  exports.addPairToJSMap = addPairToJSMap;
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS((exports) => {
  var createNode = require_createNode();
  var stringifyPair = require_stringifyPair();
  var addPairToJSMap = require_addPairToJSMap();
  var identity = require_identity();
  function createPair(key, value, ctx) {
    const k = createNode.createNode(key, undefined, ctx);
    const v = createNode.createNode(value, undefined, ctx);
    return new Pair(k, v);
  }

  class Pair {
    constructor(key, value = null) {
      Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
      this.key = key;
      this.value = value;
    }
    clone(schema) {
      let { key, value } = this;
      if (identity.isNode(key))
        key = key.clone(schema);
      if (identity.isNode(value))
        value = value.clone(schema);
      return new Pair(key, value);
    }
    toJSON(_, ctx) {
      const pair = ctx?.mapAsMap ? new Map : {};
      return addPairToJSMap.addPairToJSMap(ctx, pair, this);
    }
    toString(ctx, onComment, onChompKeep) {
      return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
    }
  }
  exports.Pair = Pair;
  exports.createPair = createPair;
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS((exports) => {
  var identity = require_identity();
  var stringify = require_stringify();
  var stringifyComment = require_stringifyComment();
  function stringifyCollection(collection, ctx, options) {
    const flow = ctx.inFlow ?? collection.flow;
    const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
    return stringify2(collection, ctx, options);
  }
  function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
    const { indent, options: { commentString } } = ctx;
    const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
    let chompKeep = false;
    const lines = [];
    for (let i = 0;i < items.length; ++i) {
      const item = items[i];
      let comment2 = null;
      if (identity.isNode(item)) {
        if (!chompKeep && item.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
        if (item.comment)
          comment2 = item.comment;
      } else if (identity.isPair(item)) {
        const ik = identity.isNode(item.key) ? item.key : null;
        if (ik) {
          if (!chompKeep && ik.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
        }
      }
      chompKeep = false;
      let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
      if (comment2)
        str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
      if (chompKeep && comment2)
        chompKeep = false;
      lines.push(blockItemPrefix + str2);
    }
    let str;
    if (lines.length === 0) {
      str = flowChars.start + flowChars.end;
    } else {
      str = lines[0];
      for (let i = 1;i < lines.length; ++i) {
        const line = lines[i];
        str += line ? `
${indent}${line}` : `
`;
      }
    }
    if (comment) {
      str += `
` + stringifyComment.indentComment(commentString(comment), indent);
      if (onComment)
        onComment();
    } else if (chompKeep && onChompKeep)
      onChompKeep();
    return str;
  }
  function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
    const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
    itemIndent += indentStep;
    const itemCtx = Object.assign({}, ctx, {
      indent: itemIndent,
      inFlow: true,
      type: null
    });
    let reqNewline = false;
    let linesAtValue = 0;
    const lines = [];
    for (let i = 0;i < items.length; ++i) {
      const item = items[i];
      let comment = null;
      if (identity.isNode(item)) {
        if (item.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, item.commentBefore, false);
        if (item.comment)
          comment = item.comment;
      } else if (identity.isPair(item)) {
        const ik = identity.isNode(item.key) ? item.key : null;
        if (ik) {
          if (ik.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, ik.commentBefore, false);
          if (ik.comment)
            reqNewline = true;
        }
        const iv = identity.isNode(item.value) ? item.value : null;
        if (iv) {
          if (iv.comment)
            comment = iv.comment;
          if (iv.commentBefore)
            reqNewline = true;
        } else if (item.value == null && ik?.comment) {
          comment = ik.comment;
        }
      }
      if (comment)
        reqNewline = true;
      let str = stringify.stringify(item, itemCtx, () => comment = null);
      reqNewline || (reqNewline = lines.length > linesAtValue || str.includes(`
`));
      if (i < items.length - 1) {
        str += ",";
      } else if (ctx.options.trailingComma) {
        if (ctx.options.lineWidth > 0) {
          reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
        }
        if (reqNewline) {
          str += ",";
        }
      }
      if (comment)
        str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
      lines.push(str);
      linesAtValue = lines.length;
    }
    const { start, end } = flowChars;
    if (lines.length === 0) {
      return start + end;
    } else {
      if (!reqNewline) {
        const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
        reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
      }
      if (reqNewline) {
        let str = start;
        for (const line of lines)
          str += line ? `
${indentStep}${indent}${line}` : `
`;
        return `${str}
${indent}${end}`;
      } else {
        return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
      }
    }
  }
  function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
    if (comment && chompKeep)
      comment = comment.replace(/^\n+/, "");
    if (comment) {
      const ic = stringifyComment.indentComment(commentString(comment), indent);
      lines.push(ic.trimStart());
    }
  }
  exports.stringifyCollection = stringifyCollection;
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS((exports) => {
  var stringifyCollection = require_stringifyCollection();
  var addPairToJSMap = require_addPairToJSMap();
  var Collection = require_Collection();
  var identity = require_identity();
  var Pair = require_Pair();
  var Scalar = require_Scalar();
  function findPair(items, key) {
    const k = identity.isScalar(key) ? key.value : key;
    for (const it of items) {
      if (identity.isPair(it)) {
        if (it.key === key || it.key === k)
          return it;
        if (identity.isScalar(it.key) && it.key.value === k)
          return it;
      }
    }
    return;
  }

  class YAMLMap extends Collection.Collection {
    static get tagName() {
      return "tag:yaml.org,2002:map";
    }
    constructor(schema) {
      super(identity.MAP, schema);
      this.items = [];
    }
    static from(schema, obj, ctx) {
      const { keepUndefined, replacer } = ctx;
      const map = new this(schema);
      const add = (key, value) => {
        if (typeof replacer === "function")
          value = replacer.call(obj, key, value);
        else if (Array.isArray(replacer) && !replacer.includes(key))
          return;
        if (value !== undefined || keepUndefined)
          map.items.push(Pair.createPair(key, value, ctx));
      };
      if (obj instanceof Map) {
        for (const [key, value] of obj)
          add(key, value);
      } else if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj))
          add(key, obj[key]);
      }
      if (typeof schema.sortMapEntries === "function") {
        map.items.sort(schema.sortMapEntries);
      }
      return map;
    }
    add(pair, overwrite) {
      let _pair;
      if (identity.isPair(pair))
        _pair = pair;
      else if (!pair || typeof pair !== "object" || !("key" in pair)) {
        _pair = new Pair.Pair(pair, pair?.value);
      } else
        _pair = new Pair.Pair(pair.key, pair.value);
      const prev = findPair(this.items, _pair.key);
      const sortEntries = this.schema?.sortMapEntries;
      if (prev) {
        if (!overwrite)
          throw new Error(`Key ${_pair.key} already set`);
        if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
          prev.value.value = _pair.value;
        else
          prev.value = _pair.value;
      } else if (sortEntries) {
        const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
        if (i === -1)
          this.items.push(_pair);
        else
          this.items.splice(i, 0, _pair);
      } else {
        this.items.push(_pair);
      }
    }
    delete(key) {
      const it = findPair(this.items, key);
      if (!it)
        return false;
      const del = this.items.splice(this.items.indexOf(it), 1);
      return del.length > 0;
    }
    get(key, keepScalar) {
      const it = findPair(this.items, key);
      const node = it?.value;
      return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? undefined;
    }
    has(key) {
      return !!findPair(this.items, key);
    }
    set(key, value) {
      this.add(new Pair.Pair(key, value), true);
    }
    toJSON(_, ctx, Type) {
      const map = Type ? new Type : ctx?.mapAsMap ? new Map : {};
      if (ctx?.onCreate)
        ctx.onCreate(map);
      for (const item of this.items)
        addPairToJSMap.addPairToJSMap(ctx, map, item);
      return map;
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      for (const item of this.items) {
        if (!identity.isPair(item))
          throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
      }
      if (!ctx.allNullValues && this.hasAllNullValues(false))
        ctx = Object.assign({}, ctx, { allNullValues: true });
      return stringifyCollection.stringifyCollection(this, ctx, {
        blockItemPrefix: "",
        flowChars: { start: "{", end: "}" },
        itemIndent: ctx.indent || "",
        onChompKeep,
        onComment
      });
    }
  }
  exports.YAMLMap = YAMLMap;
  exports.findPair = findPair;
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS((exports) => {
  var identity = require_identity();
  var YAMLMap = require_YAMLMap();
  var map = {
    collection: "map",
    default: true,
    nodeClass: YAMLMap.YAMLMap,
    tag: "tag:yaml.org,2002:map",
    resolve(map2, onError) {
      if (!identity.isMap(map2))
        onError("Expected a mapping for this tag");
      return map2;
    },
    createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
  };
  exports.map = map;
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS((exports) => {
  var createNode = require_createNode();
  var stringifyCollection = require_stringifyCollection();
  var Collection = require_Collection();
  var identity = require_identity();
  var Scalar = require_Scalar();
  var toJS = require_toJS();

  class YAMLSeq extends Collection.Collection {
    static get tagName() {
      return "tag:yaml.org,2002:seq";
    }
    constructor(schema) {
      super(identity.SEQ, schema);
      this.items = [];
    }
    add(value) {
      this.items.push(value);
    }
    delete(key) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        return false;
      const del = this.items.splice(idx, 1);
      return del.length > 0;
    }
    get(key, keepScalar) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        return;
      const it = this.items[idx];
      return !keepScalar && identity.isScalar(it) ? it.value : it;
    }
    has(key) {
      const idx = asItemIndex(key);
      return typeof idx === "number" && idx < this.items.length;
    }
    set(key, value) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        throw new Error(`Expected a valid index, not ${key}.`);
      const prev = this.items[idx];
      if (identity.isScalar(prev) && Scalar.isScalarValue(value))
        prev.value = value;
      else
        this.items[idx] = value;
    }
    toJSON(_, ctx) {
      const seq = [];
      if (ctx?.onCreate)
        ctx.onCreate(seq);
      let i = 0;
      for (const item of this.items)
        seq.push(toJS.toJS(item, String(i++), ctx));
      return seq;
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      return stringifyCollection.stringifyCollection(this, ctx, {
        blockItemPrefix: "- ",
        flowChars: { start: "[", end: "]" },
        itemIndent: (ctx.indent || "") + "  ",
        onChompKeep,
        onComment
      });
    }
    static from(schema, obj, ctx) {
      const { replacer } = ctx;
      const seq = new this(schema);
      if (obj && Symbol.iterator in Object(obj)) {
        let i = 0;
        for (let it of obj) {
          if (typeof replacer === "function") {
            const key = obj instanceof Set ? it : String(i++);
            it = replacer.call(obj, key, it);
          }
          seq.items.push(createNode.createNode(it, undefined, ctx));
        }
      }
      return seq;
    }
  }
  function asItemIndex(key) {
    let idx = identity.isScalar(key) ? key.value : key;
    if (idx && typeof idx === "string")
      idx = Number(idx);
    return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
  }
  exports.YAMLSeq = YAMLSeq;
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS((exports) => {
  var identity = require_identity();
  var YAMLSeq = require_YAMLSeq();
  var seq = {
    collection: "seq",
    default: true,
    nodeClass: YAMLSeq.YAMLSeq,
    tag: "tag:yaml.org,2002:seq",
    resolve(seq2, onError) {
      if (!identity.isSeq(seq2))
        onError("Expected a sequence for this tag");
      return seq2;
    },
    createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
  };
  exports.seq = seq;
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS((exports) => {
  var stringifyString = require_stringifyString();
  var string = {
    identify: (value) => typeof value === "string",
    default: true,
    tag: "tag:yaml.org,2002:str",
    resolve: (str) => str,
    stringify(item, ctx, onComment, onChompKeep) {
      ctx = Object.assign({ actualString: true }, ctx);
      return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
    }
  };
  exports.string = string;
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS((exports) => {
  var Scalar = require_Scalar();
  var nullTag = {
    identify: (value) => value == null,
    createNode: () => new Scalar.Scalar(null),
    default: true,
    tag: "tag:yaml.org,2002:null",
    test: /^(?:~|[Nn]ull|NULL)?$/,
    resolve: () => new Scalar.Scalar(null),
    stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
  };
  exports.nullTag = nullTag;
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS((exports) => {
  var Scalar = require_Scalar();
  var boolTag = {
    identify: (value) => typeof value === "boolean",
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
    resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
    stringify({ source, value }, ctx) {
      if (source && boolTag.test.test(source)) {
        const sv = source[0] === "t" || source[0] === "T";
        if (value === sv)
          return source;
      }
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
  };
  exports.boolTag = boolTag;
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS((exports) => {
  function stringifyNumber({ format, minFractionDigits, tag, value }) {
    if (typeof value === "bigint")
      return String(value);
    const num = typeof value === "number" ? value : Number(value);
    if (!isFinite(num))
      return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
    let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
    if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
      let i = n.indexOf(".");
      if (i < 0) {
        i = n.length;
        n += ".";
      }
      let d = minFractionDigits - (n.length - i - 1);
      while (d-- > 0)
        n += "0";
    }
    return n;
  }
  exports.stringifyNumber = stringifyNumber;
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS((exports) => {
  var Scalar = require_Scalar();
  var stringifyNumber = require_stringifyNumber();
  var floatNaN = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
    resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    stringify: stringifyNumber.stringifyNumber
  };
  var floatExp = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "EXP",
    test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
    resolve: (str) => parseFloat(str),
    stringify(node) {
      const num = Number(node.value);
      return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
    }
  };
  var float = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
    resolve(str) {
      const node = new Scalar.Scalar(parseFloat(str));
      const dot = str.indexOf(".");
      if (dot !== -1 && str[str.length - 1] === "0")
        node.minFractionDigits = str.length - dot - 1;
      return node;
    },
    stringify: stringifyNumber.stringifyNumber
  };
  exports.float = float;
  exports.floatExp = floatExp;
  exports.floatNaN = floatNaN;
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS((exports) => {
  var stringifyNumber = require_stringifyNumber();
  var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
  var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
  function intStringify(node, radix, prefix) {
    const { value } = node;
    if (intIdentify(value) && value >= 0)
      return prefix + value.toString(radix);
    return stringifyNumber.stringifyNumber(node);
  }
  var intOct = {
    identify: (value) => intIdentify(value) && value >= 0,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "OCT",
    test: /^0o[0-7]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
    stringify: (node) => intStringify(node, 8, "0o")
  };
  var int = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^[-+]?[0-9]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
    stringify: stringifyNumber.stringifyNumber
  };
  var intHex = {
    identify: (value) => intIdentify(value) && value >= 0,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "HEX",
    test: /^0x[0-9a-fA-F]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
    stringify: (node) => intStringify(node, 16, "0x")
  };
  exports.int = int;
  exports.intHex = intHex;
  exports.intOct = intOct;
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS((exports) => {
  var map = require_map();
  var _null = require_null();
  var seq = require_seq();
  var string = require_string();
  var bool = require_bool();
  var float = require_float();
  var int = require_int();
  var schema = [
    map.map,
    seq.seq,
    string.string,
    _null.nullTag,
    bool.boolTag,
    int.intOct,
    int.int,
    int.intHex,
    float.floatNaN,
    float.floatExp,
    float.float
  ];
  exports.schema = schema;
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS((exports) => {
  var Scalar = require_Scalar();
  var map = require_map();
  var seq = require_seq();
  function intIdentify(value) {
    return typeof value === "bigint" || Number.isInteger(value);
  }
  var stringifyJSON = ({ value }) => JSON.stringify(value);
  var jsonScalars = [
    {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify: stringifyJSON
    },
    {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^null$/,
      resolve: () => null,
      stringify: stringifyJSON
    },
    {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^true$|^false$/,
      resolve: (str) => str === "true",
      stringify: stringifyJSON
    },
    {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^-?(?:0|[1-9][0-9]*)$/,
      resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
      stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
    },
    {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
      resolve: (str) => parseFloat(str),
      stringify: stringifyJSON
    }
  ];
  var jsonError = {
    default: true,
    tag: "",
    test: /^/,
    resolve(str, onError) {
      onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
      return str;
    }
  };
  var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
  exports.schema = schema;
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS((exports) => {
  var node_buffer = __require("buffer");
  var Scalar = require_Scalar();
  var stringifyString = require_stringifyString();
  var binary = {
    identify: (value) => value instanceof Uint8Array,
    default: false,
    tag: "tag:yaml.org,2002:binary",
    resolve(src, onError) {
      if (typeof node_buffer.Buffer === "function") {
        return node_buffer.Buffer.from(src, "base64");
      } else if (typeof atob === "function") {
        const str = atob(src.replace(/[\n\r]/g, ""));
        const buffer = new Uint8Array(str.length);
        for (let i = 0;i < str.length; ++i)
          buffer[i] = str.charCodeAt(i);
        return buffer;
      } else {
        onError("This environment does not support reading binary tags; either Buffer or atob is required");
        return src;
      }
    },
    stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
      if (!value)
        return "";
      const buf = value;
      let str;
      if (typeof node_buffer.Buffer === "function") {
        str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
      } else if (typeof btoa === "function") {
        let s = "";
        for (let i = 0;i < buf.length; ++i)
          s += String.fromCharCode(buf[i]);
        str = btoa(s);
      } else {
        throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
      }
      type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
        const n = Math.ceil(str.length / lineWidth);
        const lines = new Array(n);
        for (let i = 0, o = 0;i < n; ++i, o += lineWidth) {
          lines[i] = str.substr(o, lineWidth);
        }
        str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? `
` : " ");
      }
      return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
    }
  };
  exports.binary = binary;
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS((exports) => {
  var identity = require_identity();
  var Pair = require_Pair();
  var Scalar = require_Scalar();
  var YAMLSeq = require_YAMLSeq();
  function resolvePairs(seq, onError) {
    if (identity.isSeq(seq)) {
      for (let i = 0;i < seq.items.length; ++i) {
        let item = seq.items[i];
        if (identity.isPair(item))
          continue;
        else if (identity.isMap(item)) {
          if (item.items.length > 1)
            onError("Each pair must have its own sequence indicator");
          const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
          if (item.commentBefore)
            pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
          if (item.comment) {
            const cn = pair.value ?? pair.key;
            cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
          }
          item = pair;
        }
        seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
      }
    } else
      onError("Expected a sequence for this tag");
    return seq;
  }
  function createPairs(schema, iterable, ctx) {
    const { replacer } = ctx;
    const pairs2 = new YAMLSeq.YAMLSeq(schema);
    pairs2.tag = "tag:yaml.org,2002:pairs";
    let i = 0;
    if (iterable && Symbol.iterator in Object(iterable))
      for (let it of iterable) {
        if (typeof replacer === "function")
          it = replacer.call(iterable, String(i++), it);
        let key, value;
        if (Array.isArray(it)) {
          if (it.length === 2) {
            key = it[0];
            value = it[1];
          } else
            throw new TypeError(`Expected [key, value] tuple: ${it}`);
        } else if (it && it instanceof Object) {
          const keys = Object.keys(it);
          if (keys.length === 1) {
            key = keys[0];
            value = it[key];
          } else {
            throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
          }
        } else {
          key = it;
        }
        pairs2.items.push(Pair.createPair(key, value, ctx));
      }
    return pairs2;
  }
  var pairs = {
    collection: "seq",
    default: false,
    tag: "tag:yaml.org,2002:pairs",
    resolve: resolvePairs,
    createNode: createPairs
  };
  exports.createPairs = createPairs;
  exports.pairs = pairs;
  exports.resolvePairs = resolvePairs;
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS((exports) => {
  var identity = require_identity();
  var toJS = require_toJS();
  var YAMLMap = require_YAMLMap();
  var YAMLSeq = require_YAMLSeq();
  var pairs = require_pairs();

  class YAMLOMap extends YAMLSeq.YAMLSeq {
    constructor() {
      super();
      this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
      this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
      this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
      this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
      this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
      this.tag = YAMLOMap.tag;
    }
    toJSON(_, ctx) {
      if (!ctx)
        return super.toJSON(_);
      const map = new Map;
      if (ctx?.onCreate)
        ctx.onCreate(map);
      for (const pair of this.items) {
        let key, value;
        if (identity.isPair(pair)) {
          key = toJS.toJS(pair.key, "", ctx);
          value = toJS.toJS(pair.value, key, ctx);
        } else {
          key = toJS.toJS(pair, "", ctx);
        }
        if (map.has(key))
          throw new Error("Ordered maps must not include duplicate keys");
        map.set(key, value);
      }
      return map;
    }
    static from(schema, iterable, ctx) {
      const pairs$1 = pairs.createPairs(schema, iterable, ctx);
      const omap2 = new this;
      omap2.items = pairs$1.items;
      return omap2;
    }
  }
  YAMLOMap.tag = "tag:yaml.org,2002:omap";
  var omap = {
    collection: "seq",
    identify: (value) => value instanceof Map,
    nodeClass: YAMLOMap,
    default: false,
    tag: "tag:yaml.org,2002:omap",
    resolve(seq, onError) {
      const pairs$1 = pairs.resolvePairs(seq, onError);
      const seenKeys = [];
      for (const { key } of pairs$1.items) {
        if (identity.isScalar(key)) {
          if (seenKeys.includes(key.value)) {
            onError(`Ordered maps must not include duplicate keys: ${key.value}`);
          } else {
            seenKeys.push(key.value);
          }
        }
      }
      return Object.assign(new YAMLOMap, pairs$1);
    },
    createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
  };
  exports.YAMLOMap = YAMLOMap;
  exports.omap = omap;
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS((exports) => {
  var Scalar = require_Scalar();
  function boolStringify({ value, source }, ctx) {
    const boolObj = value ? trueTag : falseTag;
    if (source && boolObj.test.test(source))
      return source;
    return value ? ctx.options.trueStr : ctx.options.falseStr;
  }
  var trueTag = {
    identify: (value) => value === true,
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
    resolve: () => new Scalar.Scalar(true),
    stringify: boolStringify
  };
  var falseTag = {
    identify: (value) => value === false,
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
    resolve: () => new Scalar.Scalar(false),
    stringify: boolStringify
  };
  exports.falseTag = falseTag;
  exports.trueTag = trueTag;
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS((exports) => {
  var Scalar = require_Scalar();
  var stringifyNumber = require_stringifyNumber();
  var floatNaN = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
    resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    stringify: stringifyNumber.stringifyNumber
  };
  var floatExp = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "EXP",
    test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
    resolve: (str) => parseFloat(str.replace(/_/g, "")),
    stringify(node) {
      const num = Number(node.value);
      return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
    }
  };
  var float = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
    resolve(str) {
      const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
      const dot = str.indexOf(".");
      if (dot !== -1) {
        const f = str.substring(dot + 1).replace(/_/g, "");
        if (f[f.length - 1] === "0")
          node.minFractionDigits = f.length;
      }
      return node;
    },
    stringify: stringifyNumber.stringifyNumber
  };
  exports.float = float;
  exports.floatExp = floatExp;
  exports.floatNaN = floatNaN;
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS((exports) => {
  var stringifyNumber = require_stringifyNumber();
  var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
  function intResolve(str, offset, radix, { intAsBigInt }) {
    const sign = str[0];
    if (sign === "-" || sign === "+")
      offset += 1;
    str = str.substring(offset).replace(/_/g, "");
    if (intAsBigInt) {
      switch (radix) {
        case 2:
          str = `0b${str}`;
          break;
        case 8:
          str = `0o${str}`;
          break;
        case 16:
          str = `0x${str}`;
          break;
      }
      const n2 = BigInt(str);
      return sign === "-" ? BigInt(-1) * n2 : n2;
    }
    const n = parseInt(str, radix);
    return sign === "-" ? -1 * n : n;
  }
  function intStringify(node, radix, prefix) {
    const { value } = node;
    if (intIdentify(value)) {
      const str = value.toString(radix);
      return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
    }
    return stringifyNumber.stringifyNumber(node);
  }
  var intBin = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "BIN",
    test: /^[-+]?0b[0-1_]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
    stringify: (node) => intStringify(node, 2, "0b")
  };
  var intOct = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "OCT",
    test: /^[-+]?0[0-7_]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
    stringify: (node) => intStringify(node, 8, "0")
  };
  var int = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^[-+]?[0-9][0-9_]*$/,
    resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
    stringify: stringifyNumber.stringifyNumber
  };
  var intHex = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "HEX",
    test: /^[-+]?0x[0-9a-fA-F_]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
    stringify: (node) => intStringify(node, 16, "0x")
  };
  exports.int = int;
  exports.intBin = intBin;
  exports.intHex = intHex;
  exports.intOct = intOct;
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS((exports) => {
  var identity = require_identity();
  var Pair = require_Pair();
  var YAMLMap = require_YAMLMap();

  class YAMLSet extends YAMLMap.YAMLMap {
    constructor(schema) {
      super(schema);
      this.tag = YAMLSet.tag;
    }
    add(key) {
      let pair;
      if (identity.isPair(key))
        pair = key;
      else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
        pair = new Pair.Pair(key.key, null);
      else
        pair = new Pair.Pair(key, null);
      const prev = YAMLMap.findPair(this.items, pair.key);
      if (!prev)
        this.items.push(pair);
    }
    get(key, keepPair) {
      const pair = YAMLMap.findPair(this.items, key);
      return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
    }
    set(key, value) {
      if (typeof value !== "boolean")
        throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
      const prev = YAMLMap.findPair(this.items, key);
      if (prev && !value) {
        this.items.splice(this.items.indexOf(prev), 1);
      } else if (!prev && value) {
        this.items.push(new Pair.Pair(key));
      }
    }
    toJSON(_, ctx) {
      return super.toJSON(_, ctx, Set);
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      if (this.hasAllNullValues(true))
        return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
      else
        throw new Error("Set items must all have null values");
    }
    static from(schema, iterable, ctx) {
      const { replacer } = ctx;
      const set2 = new this(schema);
      if (iterable && Symbol.iterator in Object(iterable))
        for (let value of iterable) {
          if (typeof replacer === "function")
            value = replacer.call(iterable, value, value);
          set2.items.push(Pair.createPair(value, null, ctx));
        }
      return set2;
    }
  }
  YAMLSet.tag = "tag:yaml.org,2002:set";
  var set = {
    collection: "map",
    identify: (value) => value instanceof Set,
    nodeClass: YAMLSet,
    default: false,
    tag: "tag:yaml.org,2002:set",
    createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
    resolve(map, onError) {
      if (identity.isMap(map)) {
        if (map.hasAllNullValues(true))
          return Object.assign(new YAMLSet, map);
        else
          onError("Set items must all have null values");
      } else
        onError("Expected a mapping for this tag");
      return map;
    }
  };
  exports.YAMLSet = YAMLSet;
  exports.set = set;
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS((exports) => {
  var stringifyNumber = require_stringifyNumber();
  function parseSexagesimal(str, asBigInt) {
    const sign = str[0];
    const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
    const num = (n) => asBigInt ? BigInt(n) : Number(n);
    const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
    return sign === "-" ? num(-1) * res : res;
  }
  function stringifySexagesimal(node) {
    let { value } = node;
    let num = (n) => n;
    if (typeof value === "bigint")
      num = (n) => BigInt(n);
    else if (isNaN(value) || !isFinite(value))
      return stringifyNumber.stringifyNumber(node);
    let sign = "";
    if (value < 0) {
      sign = "-";
      value *= num(-1);
    }
    const _60 = num(60);
    const parts = [value % _60];
    if (value < 60) {
      parts.unshift(0);
    } else {
      value = (value - parts[0]) / _60;
      parts.unshift(value % _60);
      if (value >= 60) {
        value = (value - parts[0]) / _60;
        parts.unshift(value);
      }
    }
    return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
  }
  var intTime = {
    identify: (value) => typeof value === "bigint" || Number.isInteger(value),
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "TIME",
    test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
    resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
    stringify: stringifySexagesimal
  };
  var floatTime = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "TIME",
    test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
    resolve: (str) => parseSexagesimal(str, false),
    stringify: stringifySexagesimal
  };
  var timestamp = {
    identify: (value) => value instanceof Date,
    default: true,
    tag: "tag:yaml.org,2002:timestamp",
    test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})" + "(?:" + "(?:t|T|[ \\t]+)" + "([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)" + "(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?" + ")?$"),
    resolve(str) {
      const match = str.match(timestamp.test);
      if (!match)
        throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
      const [, year, month, day, hour, minute, second] = match.map(Number);
      const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
      let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
      const tz = match[8];
      if (tz && tz !== "Z") {
        let d = parseSexagesimal(tz, false);
        if (Math.abs(d) < 30)
          d *= 60;
        date -= 60000 * d;
      }
      return new Date(date);
    },
    stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
  };
  exports.floatTime = floatTime;
  exports.intTime = intTime;
  exports.timestamp = timestamp;
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS((exports) => {
  var map = require_map();
  var _null = require_null();
  var seq = require_seq();
  var string = require_string();
  var binary = require_binary();
  var bool = require_bool2();
  var float = require_float2();
  var int = require_int2();
  var merge = require_merge();
  var omap = require_omap();
  var pairs = require_pairs();
  var set = require_set();
  var timestamp = require_timestamp();
  var schema = [
    map.map,
    seq.seq,
    string.string,
    _null.nullTag,
    bool.trueTag,
    bool.falseTag,
    int.intBin,
    int.intOct,
    int.int,
    int.intHex,
    float.floatNaN,
    float.floatExp,
    float.float,
    binary.binary,
    merge.merge,
    omap.omap,
    pairs.pairs,
    set.set,
    timestamp.intTime,
    timestamp.floatTime,
    timestamp.timestamp
  ];
  exports.schema = schema;
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS((exports) => {
  var map = require_map();
  var _null = require_null();
  var seq = require_seq();
  var string = require_string();
  var bool = require_bool();
  var float = require_float();
  var int = require_int();
  var schema = require_schema();
  var schema$1 = require_schema2();
  var binary = require_binary();
  var merge = require_merge();
  var omap = require_omap();
  var pairs = require_pairs();
  var schema$2 = require_schema3();
  var set = require_set();
  var timestamp = require_timestamp();
  var schemas = new Map([
    ["core", schema.schema],
    ["failsafe", [map.map, seq.seq, string.string]],
    ["json", schema$1.schema],
    ["yaml11", schema$2.schema],
    ["yaml-1.1", schema$2.schema]
  ]);
  var tagsByName = {
    binary: binary.binary,
    bool: bool.boolTag,
    float: float.float,
    floatExp: float.floatExp,
    floatNaN: float.floatNaN,
    floatTime: timestamp.floatTime,
    int: int.int,
    intHex: int.intHex,
    intOct: int.intOct,
    intTime: timestamp.intTime,
    map: map.map,
    merge: merge.merge,
    null: _null.nullTag,
    omap: omap.omap,
    pairs: pairs.pairs,
    seq: seq.seq,
    set: set.set,
    timestamp: timestamp.timestamp
  };
  var coreKnownTags = {
    "tag:yaml.org,2002:binary": binary.binary,
    "tag:yaml.org,2002:merge": merge.merge,
    "tag:yaml.org,2002:omap": omap.omap,
    "tag:yaml.org,2002:pairs": pairs.pairs,
    "tag:yaml.org,2002:set": set.set,
    "tag:yaml.org,2002:timestamp": timestamp.timestamp
  };
  function getTags(customTags, schemaName, addMergeTag) {
    const schemaTags = schemas.get(schemaName);
    if (schemaTags && !customTags) {
      return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
    }
    let tags = schemaTags;
    if (!tags) {
      if (Array.isArray(customTags))
        tags = [];
      else {
        const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
        throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
      }
    }
    if (Array.isArray(customTags)) {
      for (const tag of customTags)
        tags = tags.concat(tag);
    } else if (typeof customTags === "function") {
      tags = customTags(tags.slice());
    }
    if (addMergeTag)
      tags = tags.concat(merge.merge);
    return tags.reduce((tags2, tag) => {
      const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
      if (!tagObj) {
        const tagName = JSON.stringify(tag);
        const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
        throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
      }
      if (!tags2.includes(tagObj))
        tags2.push(tagObj);
      return tags2;
    }, []);
  }
  exports.coreKnownTags = coreKnownTags;
  exports.getTags = getTags;
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS((exports) => {
  var identity = require_identity();
  var map = require_map();
  var seq = require_seq();
  var string = require_string();
  var tags = require_tags();
  var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

  class Schema {
    constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
      this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
      this.name = typeof schema === "string" && schema || "core";
      this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
      this.tags = tags.getTags(customTags, this.name, merge);
      this.toStringOptions = toStringDefaults ?? null;
      Object.defineProperty(this, identity.MAP, { value: map.map });
      Object.defineProperty(this, identity.SCALAR, { value: string.string });
      Object.defineProperty(this, identity.SEQ, { value: seq.seq });
      this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
    }
    clone() {
      const copy = Object.create(Schema.prototype, Object.getOwnPropertyDescriptors(this));
      copy.tags = this.tags.slice();
      return copy;
    }
  }
  exports.Schema = Schema;
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS((exports) => {
  var identity = require_identity();
  var stringify = require_stringify();
  var stringifyComment = require_stringifyComment();
  function stringifyDocument(doc, options) {
    const lines = [];
    let hasDirectives = options.directives === true;
    if (options.directives !== false && doc.directives) {
      const dir = doc.directives.toString(doc);
      if (dir) {
        lines.push(dir);
        hasDirectives = true;
      } else if (doc.directives.docStart)
        hasDirectives = true;
    }
    if (hasDirectives)
      lines.push("---");
    const ctx = stringify.createStringifyContext(doc, options);
    const { commentString } = ctx.options;
    if (doc.commentBefore) {
      if (lines.length !== 1)
        lines.unshift("");
      const cs = commentString(doc.commentBefore);
      lines.unshift(stringifyComment.indentComment(cs, ""));
    }
    let chompKeep = false;
    let contentComment = null;
    if (doc.contents) {
      if (identity.isNode(doc.contents)) {
        if (doc.contents.spaceBefore && hasDirectives)
          lines.push("");
        if (doc.contents.commentBefore) {
          const cs = commentString(doc.contents.commentBefore);
          lines.push(stringifyComment.indentComment(cs, ""));
        }
        ctx.forceBlockIndent = !!doc.comment;
        contentComment = doc.contents.comment;
      }
      const onChompKeep = contentComment ? undefined : () => chompKeep = true;
      let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
      if (contentComment)
        body += stringifyComment.lineComment(body, "", commentString(contentComment));
      if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
        lines[lines.length - 1] = `--- ${body}`;
      } else
        lines.push(body);
    } else {
      lines.push(stringify.stringify(doc.contents, ctx));
    }
    if (doc.directives?.docEnd) {
      if (doc.comment) {
        const cs = commentString(doc.comment);
        if (cs.includes(`
`)) {
          lines.push("...");
          lines.push(stringifyComment.indentComment(cs, ""));
        } else {
          lines.push(`... ${cs}`);
        }
      } else {
        lines.push("...");
      }
    } else {
      let dc = doc.comment;
      if (dc && chompKeep)
        dc = dc.replace(/^\n+/, "");
      if (dc) {
        if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
          lines.push("");
        lines.push(stringifyComment.indentComment(commentString(dc), ""));
      }
    }
    return lines.join(`
`) + `
`;
  }
  exports.stringifyDocument = stringifyDocument;
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS((exports) => {
  var Alias = require_Alias();
  var Collection = require_Collection();
  var identity = require_identity();
  var Pair = require_Pair();
  var toJS = require_toJS();
  var Schema = require_Schema();
  var stringifyDocument = require_stringifyDocument();
  var anchors = require_anchors();
  var applyReviver = require_applyReviver();
  var createNode = require_createNode();
  var directives = require_directives();

  class Document {
    constructor(value, replacer, options) {
      this.commentBefore = null;
      this.comment = null;
      this.errors = [];
      this.warnings = [];
      Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === undefined && replacer) {
        options = replacer;
        replacer = undefined;
      }
      const opt = Object.assign({
        intAsBigInt: false,
        keepSourceTokens: false,
        logLevel: "warn",
        prettyErrors: true,
        strict: true,
        stringKeys: false,
        uniqueKeys: true,
        version: "1.2"
      }, options);
      this.options = opt;
      let { version } = opt;
      if (options?._directives) {
        this.directives = options._directives.atDocument();
        if (this.directives.yaml.explicit)
          version = this.directives.yaml.version;
      } else
        this.directives = new directives.Directives({ version });
      this.setSchema(version, options);
      this.contents = value === undefined ? null : this.createNode(value, _replacer, options);
    }
    clone() {
      const copy = Object.create(Document.prototype, {
        [identity.NODE_TYPE]: { value: identity.DOC }
      });
      copy.commentBefore = this.commentBefore;
      copy.comment = this.comment;
      copy.errors = this.errors.slice();
      copy.warnings = this.warnings.slice();
      copy.options = Object.assign({}, this.options);
      if (this.directives)
        copy.directives = this.directives.clone();
      copy.schema = this.schema.clone();
      copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    add(value) {
      if (assertCollection(this.contents))
        this.contents.add(value);
    }
    addIn(path, value) {
      if (assertCollection(this.contents))
        this.contents.addIn(path, value);
    }
    createAlias(node, name) {
      if (!node.anchor) {
        const prev = anchors.anchorNames(this);
        node.anchor = !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
      }
      return new Alias.Alias(node.anchor);
    }
    createNode(value, replacer, options) {
      let _replacer = undefined;
      if (typeof replacer === "function") {
        value = replacer.call({ "": value }, "", value);
        _replacer = replacer;
      } else if (Array.isArray(replacer)) {
        const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
        const asStr = replacer.filter(keyToStr).map(String);
        if (asStr.length > 0)
          replacer = replacer.concat(asStr);
        _replacer = replacer;
      } else if (options === undefined && replacer) {
        options = replacer;
        replacer = undefined;
      }
      const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
      const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(this, anchorPrefix || "a");
      const ctx = {
        aliasDuplicateObjects: aliasDuplicateObjects ?? true,
        keepUndefined: keepUndefined ?? false,
        onAnchor,
        onTagObj,
        replacer: _replacer,
        schema: this.schema,
        sourceObjects
      };
      const node = createNode.createNode(value, tag, ctx);
      if (flow && identity.isCollection(node))
        node.flow = true;
      setAnchors();
      return node;
    }
    createPair(key, value, options = {}) {
      const k = this.createNode(key, null, options);
      const v = this.createNode(value, null, options);
      return new Pair.Pair(k, v);
    }
    delete(key) {
      return assertCollection(this.contents) ? this.contents.delete(key) : false;
    }
    deleteIn(path) {
      if (Collection.isEmptyPath(path)) {
        if (this.contents == null)
          return false;
        this.contents = null;
        return true;
      }
      return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
    }
    get(key, keepScalar) {
      return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : undefined;
    }
    getIn(path, keepScalar) {
      if (Collection.isEmptyPath(path))
        return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
      return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : undefined;
    }
    has(key) {
      return identity.isCollection(this.contents) ? this.contents.has(key) : false;
    }
    hasIn(path) {
      if (Collection.isEmptyPath(path))
        return this.contents !== undefined;
      return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
    }
    set(key, value) {
      if (this.contents == null) {
        this.contents = Collection.collectionFromPath(this.schema, [key], value);
      } else if (assertCollection(this.contents)) {
        this.contents.set(key, value);
      }
    }
    setIn(path, value) {
      if (Collection.isEmptyPath(path)) {
        this.contents = value;
      } else if (this.contents == null) {
        this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
      } else if (assertCollection(this.contents)) {
        this.contents.setIn(path, value);
      }
    }
    setSchema(version, options = {}) {
      if (typeof version === "number")
        version = String(version);
      let opt;
      switch (version) {
        case "1.1":
          if (this.directives)
            this.directives.yaml.version = "1.1";
          else
            this.directives = new directives.Directives({ version: "1.1" });
          opt = { resolveKnownTags: false, schema: "yaml-1.1" };
          break;
        case "1.2":
        case "next":
          if (this.directives)
            this.directives.yaml.version = version;
          else
            this.directives = new directives.Directives({ version });
          opt = { resolveKnownTags: true, schema: "core" };
          break;
        case null:
          if (this.directives)
            delete this.directives;
          opt = null;
          break;
        default: {
          const sv = JSON.stringify(version);
          throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
        }
      }
      if (options.schema instanceof Object)
        this.schema = options.schema;
      else if (opt)
        this.schema = new Schema.Schema(Object.assign(opt, options));
      else
        throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
    }
    toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
      const ctx = {
        anchors: new Map,
        doc: this,
        keep: !json,
        mapAsMap: mapAsMap === true,
        mapKeyWarned: false,
        maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
      };
      const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
      if (typeof onAnchor === "function")
        for (const { count, res: res2 } of ctx.anchors.values())
          onAnchor(res2, count);
      return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
    }
    toJSON(jsonArg, onAnchor) {
      return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
    }
    toString(options = {}) {
      if (this.errors.length > 0)
        throw new Error("Document with errors cannot be stringified");
      if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
        const s = JSON.stringify(options.indent);
        throw new Error(`"indent" option must be a positive integer, not ${s}`);
      }
      return stringifyDocument.stringifyDocument(this, options);
    }
  }
  function assertCollection(contents) {
    if (identity.isCollection(contents))
      return true;
    throw new Error("Expected a YAML collection as document contents");
  }
  exports.Document = Document;
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS((exports) => {
  class YAMLError extends Error {
    constructor(name, pos, code, message) {
      super();
      this.name = name;
      this.code = code;
      this.message = message;
      this.pos = pos;
    }
  }

  class YAMLParseError extends YAMLError {
    constructor(pos, code, message) {
      super("YAMLParseError", pos, code, message);
    }
  }

  class YAMLWarning extends YAMLError {
    constructor(pos, code, message) {
      super("YAMLWarning", pos, code, message);
    }
  }
  var prettifyError = (src, lc) => (error) => {
    if (error.pos[0] === -1)
      return;
    error.linePos = error.pos.map((pos) => lc.linePos(pos));
    const { line, col } = error.linePos[0];
    error.message += ` at line ${line}, column ${col}`;
    let ci = col - 1;
    let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
    if (ci >= 60 && lineStr.length > 80) {
      const trimStart = Math.min(ci - 39, lineStr.length - 79);
      lineStr = "…" + lineStr.substring(trimStart);
      ci -= trimStart - 1;
    }
    if (lineStr.length > 80)
      lineStr = lineStr.substring(0, 79) + "…";
    if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
      let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
      if (prev.length > 80)
        prev = prev.substring(0, 79) + `…
`;
      lineStr = prev + lineStr;
    }
    if (/[^ ]/.test(lineStr)) {
      let count = 1;
      const end = error.linePos[1];
      if (end?.line === line && end.col > col) {
        count = Math.max(1, Math.min(end.col - col, 80 - ci));
      }
      const pointer = " ".repeat(ci) + "^".repeat(count);
      error.message += `:

${lineStr}
${pointer}
`;
    }
  };
  exports.YAMLError = YAMLError;
  exports.YAMLParseError = YAMLParseError;
  exports.YAMLWarning = YAMLWarning;
  exports.prettifyError = prettifyError;
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS((exports) => {
  function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
    let spaceBefore = false;
    let atNewline = startOnNewline;
    let hasSpace = startOnNewline;
    let comment = "";
    let commentSep = "";
    let hasNewline = false;
    let reqSpace = false;
    let tab = null;
    let anchor = null;
    let tag = null;
    let newlineAfterProp = null;
    let comma = null;
    let found = null;
    let start = null;
    for (const token of tokens) {
      if (reqSpace) {
        if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
          onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
        reqSpace = false;
      }
      if (tab) {
        if (atNewline && token.type !== "comment" && token.type !== "newline") {
          onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
        }
        tab = null;
      }
      switch (token.type) {
        case "space":
          if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("\t")) {
            tab = token;
          }
          hasSpace = true;
          break;
        case "comment": {
          if (!hasSpace)
            onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
          const cb = token.source.substring(1) || " ";
          if (!comment)
            comment = cb;
          else
            comment += commentSep + cb;
          commentSep = "";
          atNewline = false;
          break;
        }
        case "newline":
          if (atNewline) {
            if (comment)
              comment += token.source;
            else if (!found || indicator !== "seq-item-ind")
              spaceBefore = true;
          } else
            commentSep += token.source;
          atNewline = true;
          hasNewline = true;
          if (anchor || tag)
            newlineAfterProp = token;
          hasSpace = true;
          break;
        case "anchor":
          if (anchor)
            onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
          if (token.source.endsWith(":"))
            onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
          anchor = token;
          start ?? (start = token.offset);
          atNewline = false;
          hasSpace = false;
          reqSpace = true;
          break;
        case "tag": {
          if (tag)
            onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
          tag = token;
          start ?? (start = token.offset);
          atNewline = false;
          hasSpace = false;
          reqSpace = true;
          break;
        }
        case indicator:
          if (anchor || tag)
            onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
          if (found)
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
          found = token;
          atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
          hasSpace = false;
          break;
        case "comma":
          if (flow) {
            if (comma)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
            comma = token;
            atNewline = false;
            hasSpace = false;
            break;
          }
        default:
          onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
          atNewline = false;
          hasSpace = false;
      }
    }
    const last = tokens[tokens.length - 1];
    const end = last ? last.offset + last.source.length : offset;
    if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
      onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
    }
    if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
      onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
    return {
      comma,
      found,
      spaceBefore,
      comment,
      hasNewline,
      anchor,
      tag,
      newlineAfterProp,
      end,
      start: start ?? end
    };
  }
  exports.resolveProps = resolveProps;
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS((exports) => {
  function containsNewline(key) {
    if (!key)
      return null;
    switch (key.type) {
      case "alias":
      case "scalar":
      case "double-quoted-scalar":
      case "single-quoted-scalar":
        if (key.source.includes(`
`))
          return true;
        if (key.end) {
          for (const st of key.end)
            if (st.type === "newline")
              return true;
        }
        return false;
      case "flow-collection":
        for (const it of key.items) {
          for (const st of it.start)
            if (st.type === "newline")
              return true;
          if (it.sep) {
            for (const st of it.sep)
              if (st.type === "newline")
                return true;
          }
          if (containsNewline(it.key) || containsNewline(it.value))
            return true;
        }
        return false;
      default:
        return true;
    }
  }
  exports.containsNewline = containsNewline;
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS((exports) => {
  var utilContainsNewline = require_util_contains_newline();
  function flowIndentCheck(indent, fc, onError) {
    if (fc?.type === "flow-collection") {
      const end = fc.end[0];
      if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
        const msg = "Flow end indicator should be more indented than parent";
        onError(end, "BAD_INDENT", msg, true);
      }
    }
  }
  exports.flowIndentCheck = flowIndentCheck;
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS((exports) => {
  var identity = require_identity();
  function mapIncludes(ctx, items, search) {
    const { uniqueKeys } = ctx.options;
    if (uniqueKeys === false)
      return false;
    const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
    return items.some((pair) => isEqual(pair.key, search));
  }
  exports.mapIncludes = mapIncludes;
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS((exports) => {
  var Pair = require_Pair();
  var YAMLMap = require_YAMLMap();
  var resolveProps = require_resolve_props();
  var utilContainsNewline = require_util_contains_newline();
  var utilFlowIndentCheck = require_util_flow_indent_check();
  var utilMapIncludes = require_util_map_includes();
  var startColMsg = "All mapping items must start at the same column";
  function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
    const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
    const map = new NodeClass(ctx.schema);
    if (ctx.atRoot)
      ctx.atRoot = false;
    let offset = bm.offset;
    let commentEnd = null;
    for (const collItem of bm.items) {
      const { start, key, sep, value } = collItem;
      const keyProps = resolveProps.resolveProps(start, {
        indicator: "explicit-key-ind",
        next: key ?? sep?.[0],
        offset,
        onError,
        parentIndent: bm.indent,
        startOnNewline: true
      });
      const implicitKey = !keyProps.found;
      if (implicitKey) {
        if (key) {
          if (key.type === "block-seq")
            onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
          else if ("indent" in key && key.indent !== bm.indent)
            onError(offset, "BAD_INDENT", startColMsg);
        }
        if (!keyProps.anchor && !keyProps.tag && !sep) {
          commentEnd = keyProps.end;
          if (keyProps.comment) {
            if (map.comment)
              map.comment += `
` + keyProps.comment;
            else
              map.comment = keyProps.comment;
          }
          continue;
        }
        if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
          onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
        }
      } else if (keyProps.found?.indent !== bm.indent) {
        onError(offset, "BAD_INDENT", startColMsg);
      }
      ctx.atKey = true;
      const keyStart = keyProps.end;
      const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
      if (ctx.schema.compat)
        utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
      ctx.atKey = false;
      if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
        onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
      const valueProps = resolveProps.resolveProps(sep ?? [], {
        indicator: "map-value-ind",
        next: value,
        offset: keyNode.range[2],
        onError,
        parentIndent: bm.indent,
        startOnNewline: !key || key.type === "block-scalar"
      });
      offset = valueProps.end;
      if (valueProps.found) {
        if (implicitKey) {
          if (value?.type === "block-map" && !valueProps.hasNewline)
            onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
          if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
            onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
        }
        const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
        offset = valueNode.range[2];
        const pair = new Pair.Pair(keyNode, valueNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        map.items.push(pair);
      } else {
        if (implicitKey)
          onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
        if (valueProps.comment) {
          if (keyNode.comment)
            keyNode.comment += `
` + valueProps.comment;
          else
            keyNode.comment = valueProps.comment;
        }
        const pair = new Pair.Pair(keyNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        map.items.push(pair);
      }
    }
    if (commentEnd && commentEnd < offset)
      onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
    map.range = [bm.offset, offset, commentEnd ?? offset];
    return map;
  }
  exports.resolveBlockMap = resolveBlockMap;
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS((exports) => {
  var YAMLSeq = require_YAMLSeq();
  var resolveProps = require_resolve_props();
  var utilFlowIndentCheck = require_util_flow_indent_check();
  function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
    const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
    const seq = new NodeClass(ctx.schema);
    if (ctx.atRoot)
      ctx.atRoot = false;
    if (ctx.atKey)
      ctx.atKey = false;
    let offset = bs.offset;
    let commentEnd = null;
    for (const { start, value } of bs.items) {
      const props = resolveProps.resolveProps(start, {
        indicator: "seq-item-ind",
        next: value,
        offset,
        onError,
        parentIndent: bs.indent,
        startOnNewline: true
      });
      if (!props.found) {
        if (props.anchor || props.tag || value) {
          if (value?.type === "block-seq")
            onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
          else
            onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
        } else {
          commentEnd = props.end;
          if (props.comment)
            seq.comment = props.comment;
          continue;
        }
      }
      const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
      if (ctx.schema.compat)
        utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
      offset = node.range[2];
      seq.items.push(node);
    }
    seq.range = [bs.offset, offset, commentEnd ?? offset];
    return seq;
  }
  exports.resolveBlockSeq = resolveBlockSeq;
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS((exports) => {
  function resolveEnd(end, offset, reqSpace, onError) {
    let comment = "";
    if (end) {
      let hasSpace = false;
      let sep = "";
      for (const token of end) {
        const { source, type } = token;
        switch (type) {
          case "space":
            hasSpace = true;
            break;
          case "comment": {
            if (reqSpace && !hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += sep + cb;
            sep = "";
            break;
          }
          case "newline":
            if (comment)
              sep += source;
            hasSpace = true;
            break;
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
        }
        offset += source.length;
      }
    }
    return { comment, offset };
  }
  exports.resolveEnd = resolveEnd;
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS((exports) => {
  var identity = require_identity();
  var Pair = require_Pair();
  var YAMLMap = require_YAMLMap();
  var YAMLSeq = require_YAMLSeq();
  var resolveEnd = require_resolve_end();
  var resolveProps = require_resolve_props();
  var utilContainsNewline = require_util_contains_newline();
  var utilMapIncludes = require_util_map_includes();
  var blockMsg = "Block collections are not allowed within flow collections";
  var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
  function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
    const isMap = fc.start.source === "{";
    const fcName = isMap ? "flow map" : "flow sequence";
    const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
    const coll = new NodeClass(ctx.schema);
    coll.flow = true;
    const atRoot = ctx.atRoot;
    if (atRoot)
      ctx.atRoot = false;
    if (ctx.atKey)
      ctx.atKey = false;
    let offset = fc.offset + fc.start.source.length;
    for (let i = 0;i < fc.items.length; ++i) {
      const collItem = fc.items[i];
      const { start, key, sep, value } = collItem;
      const props = resolveProps.resolveProps(start, {
        flow: fcName,
        indicator: "explicit-key-ind",
        next: key ?? sep?.[0],
        offset,
        onError,
        parentIndent: fc.indent,
        startOnNewline: false
      });
      if (!props.found) {
        if (!props.anchor && !props.tag && !sep && !value) {
          if (i === 0 && props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
          else if (i < fc.items.length - 1)
            onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
          if (props.comment) {
            if (coll.comment)
              coll.comment += `
` + props.comment;
            else
              coll.comment = props.comment;
          }
          offset = props.end;
          continue;
        }
        if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
          onError(key, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
      }
      if (i === 0) {
        if (props.comma)
          onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
      } else {
        if (!props.comma)
          onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
        if (props.comment) {
          let prevItemComment = "";
          loop:
            for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
          if (prevItemComment) {
            let prev = coll.items[coll.items.length - 1];
            if (identity.isPair(prev))
              prev = prev.value ?? prev.key;
            if (prev.comment)
              prev.comment += `
` + prevItemComment;
            else
              prev.comment = prevItemComment;
            props.comment = props.comment.substring(prevItemComment.length + 1);
          }
        }
      }
      if (!isMap && !sep && !props.found) {
        const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
        coll.items.push(valueNode);
        offset = valueNode.range[2];
        if (isBlock(value))
          onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
      } else {
        ctx.atKey = true;
        const keyStart = props.end;
        const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
        if (isBlock(key))
          onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
        ctx.atKey = false;
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          flow: fcName,
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (valueProps.found) {
          if (!isMap && !props.found && ctx.options.strict) {
            if (sep)
              for (const st of sep) {
                if (st === valueProps.found)
                  break;
                if (st.type === "newline") {
                  onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                  break;
                }
              }
            if (props.start < valueProps.found.offset - 1024)
              onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
          }
        } else if (value) {
          if ("source" in value && value.source?.[0] === ":")
            onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
          else
            onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
        }
        const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
        if (valueNode) {
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else if (valueProps.comment) {
          if (keyNode.comment)
            keyNode.comment += `
` + valueProps.comment;
          else
            keyNode.comment = valueProps.comment;
        }
        const pair = new Pair.Pair(keyNode, valueNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        if (isMap) {
          const map = coll;
          if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
            onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
          map.items.push(pair);
        } else {
          const map = new YAMLMap.YAMLMap(ctx.schema);
          map.flow = true;
          map.items.push(pair);
          const endRange = (valueNode ?? keyNode).range;
          map.range = [keyNode.range[0], endRange[1], endRange[2]];
          coll.items.push(map);
        }
        offset = valueNode ? valueNode.range[2] : valueProps.end;
      }
    }
    const expectedEnd = isMap ? "}" : "]";
    const [ce, ...ee] = fc.end;
    let cePos = offset;
    if (ce?.source === expectedEnd)
      cePos = ce.offset + ce.source.length;
    else {
      const name = fcName[0].toUpperCase() + fcName.substring(1);
      const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
      onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
      if (ce && ce.source.length !== 1)
        ee.unshift(ce);
    }
    if (ee.length > 0) {
      const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
      if (end.comment) {
        if (coll.comment)
          coll.comment += `
` + end.comment;
        else
          coll.comment = end.comment;
      }
      coll.range = [fc.offset, cePos, end.offset];
    } else {
      coll.range = [fc.offset, cePos, cePos];
    }
    return coll;
  }
  exports.resolveFlowCollection = resolveFlowCollection;
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS((exports) => {
  var identity = require_identity();
  var Scalar = require_Scalar();
  var YAMLMap = require_YAMLMap();
  var YAMLSeq = require_YAMLSeq();
  var resolveBlockMap = require_resolve_block_map();
  var resolveBlockSeq = require_resolve_block_seq();
  var resolveFlowCollection = require_resolve_flow_collection();
  function resolveCollection(CN, ctx, token, onError, tagName, tag) {
    const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
    const Coll = coll.constructor;
    if (tagName === "!" || tagName === Coll.tagName) {
      coll.tag = Coll.tagName;
      return coll;
    }
    if (tagName)
      coll.tag = tagName;
    return coll;
  }
  function composeCollection(CN, ctx, token, props, onError) {
    const tagToken = props.tag;
    const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
    if (token.type === "block-seq") {
      const { anchor, newlineAfterProp: nl } = props;
      const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
      if (lastProp && (!nl || nl.offset < lastProp.offset)) {
        const message = "Missing newline after block sequence props";
        onError(lastProp, "MISSING_CHAR", message);
      }
    }
    const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
    if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
      return resolveCollection(CN, ctx, token, onError, tagName);
    }
    let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
    if (!tag) {
      const kt = ctx.schema.knownTags[tagName];
      if (kt?.collection === expType) {
        ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
        tag = kt;
      } else {
        if (kt) {
          onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
        } else {
          onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
        }
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
    }
    const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
    const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
    const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
    node.range = coll.range;
    node.tag = tagName;
    if (tag?.format)
      node.format = tag.format;
    return node;
  }
  exports.composeCollection = composeCollection;
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS((exports) => {
  var Scalar = require_Scalar();
  function resolveBlockScalar(ctx, scalar, onError) {
    const start = scalar.offset;
    const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
    if (!header)
      return { value: "", type: null, comment: "", range: [start, start, start] };
    const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
    const lines = scalar.source ? splitLines(scalar.source) : [];
    let chompStart = lines.length;
    for (let i = lines.length - 1;i >= 0; --i) {
      const content = lines[i][1];
      if (content === "" || content === "\r")
        chompStart = i;
      else
        break;
    }
    if (chompStart === 0) {
      const value2 = header.chomp === "+" && lines.length > 0 ? `
`.repeat(Math.max(1, lines.length - 1)) : "";
      let end2 = start + header.length;
      if (scalar.source)
        end2 += scalar.source.length;
      return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
    }
    let trimIndent = scalar.indent + header.indent;
    let offset = scalar.offset + header.length;
    let contentStart = 0;
    for (let i = 0;i < chompStart; ++i) {
      const [indent, content] = lines[i];
      if (content === "" || content === "\r") {
        if (header.indent === 0 && indent.length > trimIndent)
          trimIndent = indent.length;
      } else {
        if (indent.length < trimIndent) {
          const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
          onError(offset + indent.length, "MISSING_CHAR", message);
        }
        if (header.indent === 0)
          trimIndent = indent.length;
        contentStart = i;
        if (trimIndent === 0 && !ctx.atRoot) {
          const message = "Block scalar values in collections must be indented";
          onError(offset, "BAD_INDENT", message);
        }
        break;
      }
      offset += indent.length + content.length + 1;
    }
    for (let i = lines.length - 1;i >= chompStart; --i) {
      if (lines[i][0].length > trimIndent)
        chompStart = i + 1;
    }
    let value = "";
    let sep = "";
    let prevMoreIndented = false;
    for (let i = 0;i < contentStart; ++i)
      value += lines[i][0].slice(trimIndent) + `
`;
    for (let i = contentStart;i < chompStart; ++i) {
      let [indent, content] = lines[i];
      offset += indent.length + content.length + 1;
      const crlf = content[content.length - 1] === "\r";
      if (crlf)
        content = content.slice(0, -1);
      if (content && indent.length < trimIndent) {
        const src = header.indent ? "explicit indentation indicator" : "first line";
        const message = `Block scalar lines must not be less indented than their ${src}`;
        onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
        indent = "";
      }
      if (type === Scalar.Scalar.BLOCK_LITERAL) {
        value += sep + indent.slice(trimIndent) + content;
        sep = `
`;
      } else if (indent.length > trimIndent || content[0] === "\t") {
        if (sep === " ")
          sep = `
`;
        else if (!prevMoreIndented && sep === `
`)
          sep = `

`;
        value += sep + indent.slice(trimIndent) + content;
        sep = `
`;
        prevMoreIndented = true;
      } else if (content === "") {
        if (sep === `
`)
          value += `
`;
        else
          sep = `
`;
      } else {
        value += sep + content;
        sep = " ";
        prevMoreIndented = false;
      }
    }
    switch (header.chomp) {
      case "-":
        break;
      case "+":
        for (let i = chompStart;i < lines.length; ++i)
          value += `
` + lines[i][0].slice(trimIndent);
        if (value[value.length - 1] !== `
`)
          value += `
`;
        break;
      default:
        value += `
`;
    }
    const end = start + header.length + scalar.source.length;
    return { value, type, comment: header.comment, range: [start, end, end] };
  }
  function parseBlockScalarHeader({ offset, props }, strict, onError) {
    if (props[0].type !== "block-scalar-header") {
      onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
      return null;
    }
    const { source } = props[0];
    const mode = source[0];
    let indent = 0;
    let chomp = "";
    let error = -1;
    for (let i = 1;i < source.length; ++i) {
      const ch = source[i];
      if (!chomp && (ch === "-" || ch === "+"))
        chomp = ch;
      else {
        const n = Number(ch);
        if (!indent && n)
          indent = n;
        else if (error === -1)
          error = offset + i;
      }
    }
    if (error !== -1)
      onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
    let hasSpace = false;
    let comment = "";
    let length = source.length;
    for (let i = 1;i < props.length; ++i) {
      const token = props[i];
      switch (token.type) {
        case "space":
          hasSpace = true;
        case "newline":
          length += token.source.length;
          break;
        case "comment":
          if (strict && !hasSpace) {
            const message = "Comments must be separated from other tokens by white space characters";
            onError(token, "MISSING_CHAR", message);
          }
          length += token.source.length;
          comment = token.source.substring(1);
          break;
        case "error":
          onError(token, "UNEXPECTED_TOKEN", token.message);
          length += token.source.length;
          break;
        default: {
          const message = `Unexpected token in block scalar header: ${token.type}`;
          onError(token, "UNEXPECTED_TOKEN", message);
          const ts = token.source;
          if (ts && typeof ts === "string")
            length += ts.length;
        }
      }
    }
    return { mode, indent, chomp, comment, length };
  }
  function splitLines(source) {
    const split = source.split(/\n( *)/);
    const first = split[0];
    const m = first.match(/^( *)/);
    const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
    const lines = [line0];
    for (let i = 1;i < split.length; i += 2)
      lines.push([split[i], split[i + 1]]);
    return lines;
  }
  exports.resolveBlockScalar = resolveBlockScalar;
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS((exports) => {
  var Scalar = require_Scalar();
  var resolveEnd = require_resolve_end();
  function resolveFlowScalar(scalar, strict, onError) {
    const { offset, type, source, end } = scalar;
    let _type;
    let value;
    const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
    switch (type) {
      case "scalar":
        _type = Scalar.Scalar.PLAIN;
        value = plainValue(source, _onError);
        break;
      case "single-quoted-scalar":
        _type = Scalar.Scalar.QUOTE_SINGLE;
        value = singleQuotedValue(source, _onError);
        break;
      case "double-quoted-scalar":
        _type = Scalar.Scalar.QUOTE_DOUBLE;
        value = doubleQuotedValue(source, _onError);
        break;
      default:
        onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
        return {
          value: "",
          type: null,
          comment: "",
          range: [offset, offset + source.length, offset + source.length]
        };
    }
    const valueEnd = offset + source.length;
    const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
    return {
      value,
      type: _type,
      comment: re.comment,
      range: [offset, valueEnd, re.offset]
    };
  }
  function plainValue(source, onError) {
    let badChar = "";
    switch (source[0]) {
      case "\t":
        badChar = "a tab character";
        break;
      case ",":
        badChar = "flow indicator character ,";
        break;
      case "%":
        badChar = "directive indicator character %";
        break;
      case "|":
      case ">": {
        badChar = `block scalar indicator ${source[0]}`;
        break;
      }
      case "@":
      case "`": {
        badChar = `reserved character ${source[0]}`;
        break;
      }
    }
    if (badChar)
      onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
    return foldLines(source);
  }
  function singleQuotedValue(source, onError) {
    if (source[source.length - 1] !== "'" || source.length === 1)
      onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
    return foldLines(source.slice(1, -1)).replace(/''/g, "'");
  }
  function foldLines(source) {
    let first, line;
    try {
      first = new RegExp(`(.*?)(?<![ 	])[ 	]*\r?
`, "sy");
      line = new RegExp(`[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?
`, "sy");
    } catch {
      first = /(.*?)[ \t]*\r?\n/sy;
      line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
    }
    let match = first.exec(source);
    if (!match)
      return source;
    let res = match[1];
    let sep = " ";
    let pos = first.lastIndex;
    line.lastIndex = pos;
    while (match = line.exec(source)) {
      if (match[1] === "") {
        if (sep === `
`)
          res += sep;
        else
          sep = `
`;
      } else {
        res += sep + match[1];
        sep = " ";
      }
      pos = line.lastIndex;
    }
    const last = /[ \t]*(.*)/sy;
    last.lastIndex = pos;
    match = last.exec(source);
    return res + sep + (match?.[1] ?? "");
  }
  function doubleQuotedValue(source, onError) {
    let res = "";
    for (let i = 1;i < source.length - 1; ++i) {
      const ch = source[i];
      if (ch === "\r" && source[i + 1] === `
`)
        continue;
      if (ch === `
`) {
        const { fold, offset } = foldNewline(source, i);
        res += fold;
        i = offset;
      } else if (ch === "\\") {
        let next = source[++i];
        const cc = escapeCodes[next];
        if (cc)
          res += cc;
        else if (next === `
`) {
          next = source[i + 1];
          while (next === " " || next === "\t")
            next = source[++i + 1];
        } else if (next === "\r" && source[i + 1] === `
`) {
          next = source[++i + 1];
          while (next === " " || next === "\t")
            next = source[++i + 1];
        } else if (next === "x" || next === "u" || next === "U") {
          const length = next === "x" ? 2 : next === "u" ? 4 : 8;
          res += parseCharCode(source, i + 1, length, onError);
          i += length;
        } else {
          const raw = source.substr(i - 1, 2);
          onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
          res += raw;
        }
      } else if (ch === " " || ch === "\t") {
        const wsStart = i;
        let next = source[i + 1];
        while (next === " " || next === "\t")
          next = source[++i + 1];
        if (next !== `
` && !(next === "\r" && source[i + 2] === `
`))
          res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
      } else {
        res += ch;
      }
    }
    if (source[source.length - 1] !== '"' || source.length === 1)
      onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
    return res;
  }
  function foldNewline(source, offset) {
    let fold = "";
    let ch = source[offset + 1];
    while (ch === " " || ch === "\t" || ch === `
` || ch === "\r") {
      if (ch === "\r" && source[offset + 2] !== `
`)
        break;
      if (ch === `
`)
        fold += `
`;
      offset += 1;
      ch = source[offset + 1];
    }
    if (!fold)
      fold = " ";
    return { fold, offset };
  }
  var escapeCodes = {
    "0": "\x00",
    a: "\x07",
    b: "\b",
    e: "\x1B",
    f: "\f",
    n: `
`,
    r: "\r",
    t: "\t",
    v: "\v",
    N: "",
    _: " ",
    L: "\u2028",
    P: "\u2029",
    " ": " ",
    '"': '"',
    "/": "/",
    "\\": "\\",
    "\t": "\t"
  };
  function parseCharCode(source, offset, length, onError) {
    const cc = source.substr(offset, length);
    const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
    const code = ok ? parseInt(cc, 16) : NaN;
    try {
      return String.fromCodePoint(code);
    } catch {
      const raw = source.substr(offset - 2, length + 2);
      onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
      return raw;
    }
  }
  exports.resolveFlowScalar = resolveFlowScalar;
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS((exports) => {
  var identity = require_identity();
  var Scalar = require_Scalar();
  var resolveBlockScalar = require_resolve_block_scalar();
  var resolveFlowScalar = require_resolve_flow_scalar();
  function composeScalar(ctx, token, tagToken, onError) {
    const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
    const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
    let tag;
    if (ctx.options.stringKeys && ctx.atKey) {
      tag = ctx.schema[identity.SCALAR];
    } else if (tagName)
      tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
    else if (token.type === "scalar")
      tag = findScalarTagByTest(ctx, value, token, onError);
    else
      tag = ctx.schema[identity.SCALAR];
    let scalar;
    try {
      const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
      scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
      scalar = new Scalar.Scalar(value);
    }
    scalar.range = range;
    scalar.source = value;
    if (type)
      scalar.type = type;
    if (tagName)
      scalar.tag = tagName;
    if (tag.format)
      scalar.format = tag.format;
    if (comment)
      scalar.comment = comment;
    return scalar;
  }
  function findScalarTagByName(schema, value, tagName, tagToken, onError) {
    if (tagName === "!")
      return schema[identity.SCALAR];
    const matchWithTest = [];
    for (const tag of schema.tags) {
      if (!tag.collection && tag.tag === tagName) {
        if (tag.default && tag.test)
          matchWithTest.push(tag);
        else
          return tag;
      }
    }
    for (const tag of matchWithTest)
      if (tag.test?.test(value))
        return tag;
    const kt = schema.knownTags[tagName];
    if (kt && !kt.collection) {
      schema.tags.push(Object.assign({}, kt, { default: false, test: undefined }));
      return kt;
    }
    onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
    return schema[identity.SCALAR];
  }
  function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
    const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
    if (schema.compat) {
      const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
      if (tag.tag !== compat.tag) {
        const ts = directives.tagString(tag.tag);
        const cs = directives.tagString(compat.tag);
        const msg = `Value may be parsed as either ${ts} or ${cs}`;
        onError(token, "TAG_RESOLVE_FAILED", msg, true);
      }
    }
    return tag;
  }
  exports.composeScalar = composeScalar;
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS((exports) => {
  function emptyScalarPosition(offset, before, pos) {
    if (before) {
      pos ?? (pos = before.length);
      for (let i = pos - 1;i >= 0; --i) {
        let st = before[i];
        switch (st.type) {
          case "space":
          case "comment":
          case "newline":
            offset -= st.source.length;
            continue;
        }
        st = before[++i];
        while (st?.type === "space") {
          offset += st.source.length;
          st = before[++i];
        }
        break;
      }
    }
    return offset;
  }
  exports.emptyScalarPosition = emptyScalarPosition;
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS((exports) => {
  var Alias = require_Alias();
  var identity = require_identity();
  var composeCollection = require_compose_collection();
  var composeScalar = require_compose_scalar();
  var resolveEnd = require_resolve_end();
  var utilEmptyScalarPosition = require_util_empty_scalar_position();
  var CN = { composeNode, composeEmptyNode };
  function composeNode(ctx, token, props, onError) {
    const atKey = ctx.atKey;
    const { spaceBefore, comment, anchor, tag } = props;
    let node;
    let isSrcToken = true;
    switch (token.type) {
      case "alias":
        node = composeAlias(ctx, token, onError);
        if (anchor || tag)
          onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
        break;
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
      case "block-scalar":
        node = composeScalar.composeScalar(ctx, token, tag, onError);
        if (anchor)
          node.anchor = anchor.source.substring(1);
        break;
      case "block-map":
      case "block-seq":
      case "flow-collection":
        try {
          node = composeCollection.composeCollection(CN, ctx, token, props, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          onError(token, "RESOURCE_EXHAUSTION", message);
        }
        break;
      default: {
        const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
        onError(token, "UNEXPECTED_TOKEN", message);
        isSrcToken = false;
      }
    }
    node ?? (node = composeEmptyNode(ctx, token.offset, undefined, null, props, onError));
    if (anchor && node.anchor === "")
      onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
    if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
      const msg = "With stringKeys, all keys must be strings";
      onError(tag ?? token, "NON_STRING_KEY", msg);
    }
    if (spaceBefore)
      node.spaceBefore = true;
    if (comment) {
      if (token.type === "scalar" && token.source === "")
        node.comment = comment;
      else
        node.commentBefore = comment;
    }
    if (ctx.options.keepSourceTokens && isSrcToken)
      node.srcToken = token;
    return node;
  }
  function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
    const token = {
      type: "scalar",
      offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
      indent: -1,
      source: ""
    };
    const node = composeScalar.composeScalar(ctx, token, tag, onError);
    if (anchor) {
      node.anchor = anchor.source.substring(1);
      if (node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
    }
    if (spaceBefore)
      node.spaceBefore = true;
    if (comment) {
      node.comment = comment;
      node.range[2] = end;
    }
    return node;
  }
  function composeAlias({ options }, { offset, source, end }, onError) {
    const alias = new Alias.Alias(source.substring(1));
    if (alias.source === "")
      onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
    if (alias.source.endsWith(":"))
      onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
    const valueEnd = offset + source.length;
    const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
    alias.range = [offset, valueEnd, re.offset];
    if (re.comment)
      alias.comment = re.comment;
    return alias;
  }
  exports.composeEmptyNode = composeEmptyNode;
  exports.composeNode = composeNode;
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS((exports) => {
  var Document = require_Document();
  var composeNode = require_compose_node();
  var resolveEnd = require_resolve_end();
  var resolveProps = require_resolve_props();
  function composeDoc(options, directives, { offset, start, value, end }, onError) {
    const opts = Object.assign({ _directives: directives }, options);
    const doc = new Document.Document(undefined, opts);
    const ctx = {
      atKey: false,
      atRoot: true,
      directives: doc.directives,
      options: doc.options,
      schema: doc.schema
    };
    const props = resolveProps.resolveProps(start, {
      indicator: "doc-start",
      next: value ?? end?.[0],
      offset,
      onError,
      parentIndent: 0,
      startOnNewline: true
    });
    if (props.found) {
      doc.directives.docStart = true;
      if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
        onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
    }
    doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
    const contentEnd = doc.contents.range[2];
    const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
    if (re.comment)
      doc.comment = re.comment;
    doc.range = [offset, contentEnd, re.offset];
    return doc;
  }
  exports.composeDoc = composeDoc;
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS((exports) => {
  var node_process = __require("process");
  var directives = require_directives();
  var Document = require_Document();
  var errors = require_errors();
  var identity = require_identity();
  var composeDoc = require_compose_doc();
  var resolveEnd = require_resolve_end();
  function getErrorPos(src) {
    if (typeof src === "number")
      return [src, src + 1];
    if (Array.isArray(src))
      return src.length === 2 ? src : [src[0], src[1]];
    const { offset, source } = src;
    return [offset, offset + (typeof source === "string" ? source.length : 1)];
  }
  function parsePrelude(prelude) {
    let comment = "";
    let atComment = false;
    let afterEmptyLine = false;
    for (let i = 0;i < prelude.length; ++i) {
      const source = prelude[i];
      switch (source[0]) {
        case "#":
          comment += (comment === "" ? "" : afterEmptyLine ? `

` : `
`) + (source.substring(1) || " ");
          atComment = true;
          afterEmptyLine = false;
          break;
        case "%":
          if (prelude[i + 1]?.[0] !== "#")
            i += 1;
          atComment = false;
          break;
        default:
          if (!atComment)
            afterEmptyLine = true;
          atComment = false;
      }
    }
    return { comment, afterEmptyLine };
  }

  class Composer {
    constructor(options = {}) {
      this.doc = null;
      this.atDirectives = false;
      this.prelude = [];
      this.errors = [];
      this.warnings = [];
      this.onError = (source, code, message, warning) => {
        const pos = getErrorPos(source);
        if (warning)
          this.warnings.push(new errors.YAMLWarning(pos, code, message));
        else
          this.errors.push(new errors.YAMLParseError(pos, code, message));
      };
      this.directives = new directives.Directives({ version: options.version || "1.2" });
      this.options = options;
    }
    decorate(doc, afterDoc) {
      const { comment, afterEmptyLine } = parsePrelude(this.prelude);
      if (comment) {
        const dc = doc.contents;
        if (afterDoc) {
          doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
        } else if (afterEmptyLine || doc.directives.docStart || !dc) {
          doc.commentBefore = comment;
        } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
          let it = dc.items[0];
          if (identity.isPair(it))
            it = it.key;
          const cb = it.commentBefore;
          it.commentBefore = cb ? `${comment}
${cb}` : comment;
        } else {
          const cb = dc.commentBefore;
          dc.commentBefore = cb ? `${comment}
${cb}` : comment;
        }
      }
      if (afterDoc) {
        Array.prototype.push.apply(doc.errors, this.errors);
        Array.prototype.push.apply(doc.warnings, this.warnings);
      } else {
        doc.errors = this.errors;
        doc.warnings = this.warnings;
      }
      this.prelude = [];
      this.errors = [];
      this.warnings = [];
    }
    streamInfo() {
      return {
        comment: parsePrelude(this.prelude).comment,
        directives: this.directives,
        errors: this.errors,
        warnings: this.warnings
      };
    }
    *compose(tokens, forceDoc = false, endOffset = -1) {
      for (const token of tokens)
        yield* this.next(token);
      yield* this.end(forceDoc, endOffset);
    }
    *next(token) {
      if (node_process.env.LOG_STREAM)
        console.dir(token, { depth: null });
      switch (token.type) {
        case "directive":
          this.directives.add(token.source, (offset, message, warning) => {
            const pos = getErrorPos(token);
            pos[0] += offset;
            this.onError(pos, "BAD_DIRECTIVE", message, warning);
          });
          this.prelude.push(token.source);
          this.atDirectives = true;
          break;
        case "document": {
          const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
          if (this.atDirectives && !doc.directives.docStart)
            this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
          this.decorate(doc, false);
          if (this.doc)
            yield this.doc;
          this.doc = doc;
          this.atDirectives = false;
          break;
        }
        case "byte-order-mark":
        case "space":
          break;
        case "comment":
        case "newline":
          this.prelude.push(token.source);
          break;
        case "error": {
          const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
          const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
          if (this.atDirectives || !this.doc)
            this.errors.push(error);
          else
            this.doc.errors.push(error);
          break;
        }
        case "doc-end": {
          if (!this.doc) {
            const msg = "Unexpected doc-end without preceding document";
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
            break;
          }
          this.doc.directives.docEnd = true;
          const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
          this.decorate(this.doc, true);
          if (end.comment) {
            const dc = this.doc.comment;
            this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
          }
          this.doc.range[2] = end.offset;
          break;
        }
        default:
          this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
      }
    }
    *end(forceDoc = false, endOffset = -1) {
      if (this.doc) {
        this.decorate(this.doc, true);
        yield this.doc;
        this.doc = null;
      } else if (forceDoc) {
        const opts = Object.assign({ _directives: this.directives }, this.options);
        const doc = new Document.Document(undefined, opts);
        if (this.atDirectives)
          this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
        doc.range = [0, endOffset, endOffset];
        this.decorate(doc, false);
        yield doc;
      }
    }
  }
  exports.Composer = Composer;
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS((exports) => {
  var resolveBlockScalar = require_resolve_block_scalar();
  var resolveFlowScalar = require_resolve_flow_scalar();
  var errors = require_errors();
  var stringifyString = require_stringifyString();
  function resolveAsScalar(token, strict = true, onError) {
    if (token) {
      const _onError = (pos, code, message) => {
        const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
        if (onError)
          onError(offset, code, message);
        else
          throw new errors.YAMLParseError([offset, offset + 1], code, message);
      };
      switch (token.type) {
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
        case "block-scalar":
          return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
      }
    }
    return null;
  }
  function createScalarToken(value, context) {
    const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
    const source = stringifyString.stringifyString({ type, value }, {
      implicitKey,
      indent: indent > 0 ? " ".repeat(indent) : "",
      inFlow,
      options: { blockQuote: true, lineWidth: -1 }
    });
    const end = context.end ?? [
      { type: "newline", offset: -1, indent, source: `
` }
    ];
    switch (source[0]) {
      case "|":
      case ">": {
        const he = source.indexOf(`
`);
        const head = source.substring(0, he);
        const body = source.substring(he + 1) + `
`;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, end))
          props.push({ type: "newline", offset: -1, indent, source: `
` });
        return { type: "block-scalar", offset, indent, props, source: body };
      }
      case '"':
        return { type: "double-quoted-scalar", offset, indent, source, end };
      case "'":
        return { type: "single-quoted-scalar", offset, indent, source, end };
      default:
        return { type: "scalar", offset, indent, source, end };
    }
  }
  function setScalarValue(token, value, context = {}) {
    let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
    let indent = "indent" in token ? token.indent : null;
    if (afterKey && typeof indent === "number")
      indent += 2;
    if (!type)
      switch (token.type) {
        case "single-quoted-scalar":
          type = "QUOTE_SINGLE";
          break;
        case "double-quoted-scalar":
          type = "QUOTE_DOUBLE";
          break;
        case "block-scalar": {
          const header = token.props[0];
          if (header.type !== "block-scalar-header")
            throw new Error("Invalid block scalar header");
          type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
          break;
        }
        default:
          type = "PLAIN";
      }
    const source = stringifyString.stringifyString({ type, value }, {
      implicitKey: implicitKey || indent === null,
      indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
      inFlow,
      options: { blockQuote: true, lineWidth: -1 }
    });
    switch (source[0]) {
      case "|":
      case ">":
        setBlockScalarValue(token, source);
        break;
      case '"':
        setFlowScalarValue(token, source, "double-quoted-scalar");
        break;
      case "'":
        setFlowScalarValue(token, source, "single-quoted-scalar");
        break;
      default:
        setFlowScalarValue(token, source, "scalar");
    }
  }
  function setBlockScalarValue(token, source) {
    const he = source.indexOf(`
`);
    const head = source.substring(0, he);
    const body = source.substring(he + 1) + `
`;
    if (token.type === "block-scalar") {
      const header = token.props[0];
      if (header.type !== "block-scalar-header")
        throw new Error("Invalid block scalar header");
      header.source = head;
      token.source = body;
    } else {
      const { offset } = token;
      const indent = "indent" in token ? token.indent : -1;
      const props = [
        { type: "block-scalar-header", offset, indent, source: head }
      ];
      if (!addEndtoBlockProps(props, "end" in token ? token.end : undefined))
        props.push({ type: "newline", offset: -1, indent, source: `
` });
      for (const key of Object.keys(token))
        if (key !== "type" && key !== "offset")
          delete token[key];
      Object.assign(token, { type: "block-scalar", indent, props, source: body });
    }
  }
  function addEndtoBlockProps(props, end) {
    if (end)
      for (const st of end)
        switch (st.type) {
          case "space":
          case "comment":
            props.push(st);
            break;
          case "newline":
            props.push(st);
            return true;
        }
    return false;
  }
  function setFlowScalarValue(token, source, type) {
    switch (token.type) {
      case "scalar":
      case "double-quoted-scalar":
      case "single-quoted-scalar":
        token.type = type;
        token.source = source;
        break;
      case "block-scalar": {
        const end = token.props.slice(1);
        let oa = source.length;
        if (token.props[0].type === "block-scalar-header")
          oa -= token.props[0].source.length;
        for (const tok of end)
          tok.offset += oa;
        delete token.props;
        Object.assign(token, { type, source, end });
        break;
      }
      case "block-map":
      case "block-seq": {
        const offset = token.offset + source.length;
        const nl = { type: "newline", offset, indent: token.indent, source: `
` };
        delete token.items;
        Object.assign(token, { type, source, end: [nl] });
        break;
      }
      default: {
        const indent = "indent" in token ? token.indent : -1;
        const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type, indent, source, end });
      }
    }
  }
  exports.createScalarToken = createScalarToken;
  exports.resolveAsScalar = resolveAsScalar;
  exports.setScalarValue = setScalarValue;
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS((exports) => {
  var stringify = (cst) => ("type" in cst) ? stringifyToken(cst) : stringifyItem(cst);
  function stringifyToken(token) {
    switch (token.type) {
      case "block-scalar": {
        let res = "";
        for (const tok of token.props)
          res += stringifyToken(tok);
        return res + token.source;
      }
      case "block-map":
      case "block-seq": {
        let res = "";
        for (const item of token.items)
          res += stringifyItem(item);
        return res;
      }
      case "flow-collection": {
        let res = token.start.source;
        for (const item of token.items)
          res += stringifyItem(item);
        for (const st of token.end)
          res += st.source;
        return res;
      }
      case "document": {
        let res = stringifyItem(token);
        if (token.end)
          for (const st of token.end)
            res += st.source;
        return res;
      }
      default: {
        let res = token.source;
        if ("end" in token && token.end)
          for (const st of token.end)
            res += st.source;
        return res;
      }
    }
  }
  function stringifyItem({ start, key, sep, value }) {
    let res = "";
    for (const st of start)
      res += st.source;
    if (key)
      res += stringifyToken(key);
    if (sep)
      for (const st of sep)
        res += st.source;
    if (value)
      res += stringifyToken(value);
    return res;
  }
  exports.stringify = stringify;
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS((exports) => {
  var BREAK = Symbol("break visit");
  var SKIP = Symbol("skip children");
  var REMOVE = Symbol("remove item");
  function visit(cst, visitor) {
    if ("type" in cst && cst.type === "document")
      cst = { start: cst.start, value: cst.value };
    _visit(Object.freeze([]), cst, visitor);
  }
  visit.BREAK = BREAK;
  visit.SKIP = SKIP;
  visit.REMOVE = REMOVE;
  visit.itemAtPath = (cst, path) => {
    let item = cst;
    for (const [field, index] of path) {
      const tok = item?.[field];
      if (tok && "items" in tok) {
        item = tok.items[index];
      } else
        return;
    }
    return item;
  };
  visit.parentCollection = (cst, path) => {
    const parent = visit.itemAtPath(cst, path.slice(0, -1));
    const field = path[path.length - 1][0];
    const coll = parent?.[field];
    if (coll && "items" in coll)
      return coll;
    throw new Error("Parent collection not found");
  };
  function _visit(path, item, visitor) {
    let ctrl = visitor(item, path);
    if (typeof ctrl === "symbol")
      return ctrl;
    for (const field of ["key", "value"]) {
      const token = item[field];
      if (token && "items" in token) {
        for (let i = 0;i < token.items.length; ++i) {
          const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK)
            return BREAK;
          else if (ci === REMOVE) {
            token.items.splice(i, 1);
            i -= 1;
          }
        }
        if (typeof ctrl === "function" && field === "key")
          ctrl = ctrl(item, path);
      }
    }
    return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
  }
  exports.visit = visit;
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS((exports) => {
  var cstScalar = require_cst_scalar();
  var cstStringify = require_cst_stringify();
  var cstVisit = require_cst_visit();
  var BOM = "\uFEFF";
  var DOCUMENT = "\x02";
  var FLOW_END = "\x18";
  var SCALAR = "\x1F";
  var isCollection = (token) => !!token && ("items" in token);
  var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
  function prettyToken(token) {
    switch (token) {
      case BOM:
        return "<BOM>";
      case DOCUMENT:
        return "<DOC>";
      case FLOW_END:
        return "<FLOW_END>";
      case SCALAR:
        return "<SCALAR>";
      default:
        return JSON.stringify(token);
    }
  }
  function tokenType(source) {
    switch (source) {
      case BOM:
        return "byte-order-mark";
      case DOCUMENT:
        return "doc-mode";
      case FLOW_END:
        return "flow-error-end";
      case SCALAR:
        return "scalar";
      case "---":
        return "doc-start";
      case "...":
        return "doc-end";
      case "":
      case `
`:
      case `\r
`:
        return "newline";
      case "-":
        return "seq-item-ind";
      case "?":
        return "explicit-key-ind";
      case ":":
        return "map-value-ind";
      case "{":
        return "flow-map-start";
      case "}":
        return "flow-map-end";
      case "[":
        return "flow-seq-start";
      case "]":
        return "flow-seq-end";
      case ",":
        return "comma";
    }
    switch (source[0]) {
      case " ":
      case "\t":
        return "space";
      case "#":
        return "comment";
      case "%":
        return "directive-line";
      case "*":
        return "alias";
      case "&":
        return "anchor";
      case "!":
        return "tag";
      case "'":
        return "single-quoted-scalar";
      case '"':
        return "double-quoted-scalar";
      case "|":
      case ">":
        return "block-scalar-header";
    }
    return null;
  }
  exports.createScalarToken = cstScalar.createScalarToken;
  exports.resolveAsScalar = cstScalar.resolveAsScalar;
  exports.setScalarValue = cstScalar.setScalarValue;
  exports.stringify = cstStringify.stringify;
  exports.visit = cstVisit.visit;
  exports.BOM = BOM;
  exports.DOCUMENT = DOCUMENT;
  exports.FLOW_END = FLOW_END;
  exports.SCALAR = SCALAR;
  exports.isCollection = isCollection;
  exports.isScalar = isScalar;
  exports.prettyToken = prettyToken;
  exports.tokenType = tokenType;
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS((exports) => {
  var cst = require_cst();
  function isEmpty(ch) {
    switch (ch) {
      case undefined:
      case " ":
      case `
`:
      case "\r":
      case "\t":
        return true;
      default:
        return false;
    }
  }
  var hexDigits = new Set("0123456789ABCDEFabcdef");
  var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
  var flowIndicatorChars = new Set(",[]{}");
  var invalidAnchorChars = new Set(` ,[]{}
\r	`);
  var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);

  class Lexer {
    constructor() {
      this.atEnd = false;
      this.blockScalarIndent = -1;
      this.blockScalarKeep = false;
      this.buffer = "";
      this.flowKey = false;
      this.flowLevel = 0;
      this.indentNext = 0;
      this.indentValue = 0;
      this.lineEndPos = null;
      this.next = null;
      this.pos = 0;
    }
    *lex(source, incomplete = false) {
      if (source) {
        if (typeof source !== "string")
          throw TypeError("source is not a string");
        this.buffer = this.buffer ? this.buffer + source : source;
        this.lineEndPos = null;
      }
      this.atEnd = !incomplete;
      let next = this.next ?? "stream";
      while (next && (incomplete || this.hasChars(1)))
        next = yield* this.parseNext(next);
    }
    atLineEnd() {
      let i = this.pos;
      let ch = this.buffer[i];
      while (ch === " " || ch === "\t")
        ch = this.buffer[++i];
      if (!ch || ch === "#" || ch === `
`)
        return true;
      if (ch === "\r")
        return this.buffer[i + 1] === `
`;
      return false;
    }
    charAt(n) {
      return this.buffer[this.pos + n];
    }
    continueScalar(offset) {
      let ch = this.buffer[offset];
      if (this.indentNext > 0) {
        let indent = 0;
        while (ch === " ")
          ch = this.buffer[++indent + offset];
        if (ch === "\r") {
          const next = this.buffer[indent + offset + 1];
          if (next === `
` || !next && !this.atEnd)
            return offset + indent + 1;
        }
        return ch === `
` || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
      }
      if (ch === "-" || ch === ".") {
        const dt = this.buffer.substr(offset, 3);
        if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
          return -1;
      }
      return offset;
    }
    getLine() {
      let end = this.lineEndPos;
      if (typeof end !== "number" || end !== -1 && end < this.pos) {
        end = this.buffer.indexOf(`
`, this.pos);
        this.lineEndPos = end;
      }
      if (end === -1)
        return this.atEnd ? this.buffer.substring(this.pos) : null;
      if (this.buffer[end - 1] === "\r")
        end -= 1;
      return this.buffer.substring(this.pos, end);
    }
    hasChars(n) {
      return this.pos + n <= this.buffer.length;
    }
    setNext(state) {
      this.buffer = this.buffer.substring(this.pos);
      this.pos = 0;
      this.lineEndPos = null;
      this.next = state;
      return null;
    }
    peek(n) {
      return this.buffer.substr(this.pos, n);
    }
    *parseNext(next) {
      switch (next) {
        case "stream":
          return yield* this.parseStream();
        case "line-start":
          return yield* this.parseLineStart();
        case "block-start":
          return yield* this.parseBlockStart();
        case "doc":
          return yield* this.parseDocument();
        case "flow":
          return yield* this.parseFlowCollection();
        case "quoted-scalar":
          return yield* this.parseQuotedScalar();
        case "block-scalar":
          return yield* this.parseBlockScalar();
        case "plain-scalar":
          return yield* this.parsePlainScalar();
      }
    }
    *parseStream() {
      let line = this.getLine();
      if (line === null)
        return this.setNext("stream");
      if (line[0] === cst.BOM) {
        yield* this.pushCount(1);
        line = line.substring(1);
      }
      if (line[0] === "%") {
        let dirEnd = line.length;
        let cs = line.indexOf("#");
        while (cs !== -1) {
          const ch = line[cs - 1];
          if (ch === " " || ch === "\t") {
            dirEnd = cs - 1;
            break;
          } else {
            cs = line.indexOf("#", cs + 1);
          }
        }
        while (true) {
          const ch = line[dirEnd - 1];
          if (ch === " " || ch === "\t")
            dirEnd -= 1;
          else
            break;
        }
        const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
        yield* this.pushCount(line.length - n);
        this.pushNewline();
        return "stream";
      }
      if (this.atLineEnd()) {
        const sp = yield* this.pushSpaces(true);
        yield* this.pushCount(line.length - sp);
        yield* this.pushNewline();
        return "stream";
      }
      yield cst.DOCUMENT;
      return yield* this.parseLineStart();
    }
    *parseLineStart() {
      const ch = this.charAt(0);
      if (!ch && !this.atEnd)
        return this.setNext("line-start");
      if (ch === "-" || ch === ".") {
        if (!this.atEnd && !this.hasChars(4))
          return this.setNext("line-start");
        const s = this.peek(3);
        if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
          yield* this.pushCount(3);
          this.indentValue = 0;
          this.indentNext = 0;
          return s === "---" ? "doc" : "stream";
        }
      }
      this.indentValue = yield* this.pushSpaces(false);
      if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
        this.indentNext = this.indentValue;
      return yield* this.parseBlockStart();
    }
    *parseBlockStart() {
      const [ch0, ch1] = this.peek(2);
      if (!ch1 && !this.atEnd)
        return this.setNext("block-start");
      if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
        const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
        this.indentNext = this.indentValue + 1;
        this.indentValue += n;
        return yield* this.parseBlockStart();
      }
      return "doc";
    }
    *parseDocument() {
      yield* this.pushSpaces(true);
      const line = this.getLine();
      if (line === null)
        return this.setNext("doc");
      let n = yield* this.pushIndicators();
      switch (line[n]) {
        case "#":
          yield* this.pushCount(line.length - n);
        case undefined:
          yield* this.pushNewline();
          return yield* this.parseLineStart();
        case "{":
        case "[":
          yield* this.pushCount(1);
          this.flowKey = false;
          this.flowLevel = 1;
          return "flow";
        case "}":
        case "]":
          yield* this.pushCount(1);
          return "doc";
        case "*":
          yield* this.pushUntil(isNotAnchorChar);
          return "doc";
        case '"':
        case "'":
          return yield* this.parseQuotedScalar();
        case "|":
        case ">":
          n += yield* this.parseBlockScalarHeader();
          n += yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - n);
          yield* this.pushNewline();
          return yield* this.parseBlockScalar();
        default:
          return yield* this.parsePlainScalar();
      }
    }
    *parseFlowCollection() {
      let nl, sp;
      let indent = -1;
      do {
        nl = yield* this.pushNewline();
        if (nl > 0) {
          sp = yield* this.pushSpaces(false);
          this.indentValue = indent = sp;
        } else {
          sp = 0;
        }
        sp += yield* this.pushSpaces(true);
      } while (nl + sp > 0);
      const line = this.getLine();
      if (line === null)
        return this.setNext("flow");
      if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
        const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
        if (!atFlowEndMarker) {
          this.flowLevel = 0;
          yield cst.FLOW_END;
          return yield* this.parseLineStart();
        }
      }
      let n = 0;
      while (line[n] === ",") {
        n += yield* this.pushCount(1);
        n += yield* this.pushSpaces(true);
        this.flowKey = false;
      }
      n += yield* this.pushIndicators();
      switch (line[n]) {
        case undefined:
          return "flow";
        case "#":
          yield* this.pushCount(line.length - n);
          return "flow";
        case "{":
        case "[":
          yield* this.pushCount(1);
          this.flowKey = false;
          this.flowLevel += 1;
          return "flow";
        case "}":
        case "]":
          yield* this.pushCount(1);
          this.flowKey = true;
          this.flowLevel -= 1;
          return this.flowLevel ? "flow" : "doc";
        case "*":
          yield* this.pushUntil(isNotAnchorChar);
          return "flow";
        case '"':
        case "'":
          this.flowKey = true;
          return yield* this.parseQuotedScalar();
        case ":": {
          const next = this.charAt(1);
          if (this.flowKey || isEmpty(next) || next === ",") {
            this.flowKey = false;
            yield* this.pushCount(1);
            yield* this.pushSpaces(true);
            return "flow";
          }
        }
        default:
          this.flowKey = false;
          return yield* this.parsePlainScalar();
      }
    }
    *parseQuotedScalar() {
      const quote = this.charAt(0);
      let end = this.buffer.indexOf(quote, this.pos + 1);
      if (quote === "'") {
        while (end !== -1 && this.buffer[end + 1] === "'")
          end = this.buffer.indexOf("'", end + 2);
      } else {
        while (end !== -1) {
          let n = 0;
          while (this.buffer[end - 1 - n] === "\\")
            n += 1;
          if (n % 2 === 0)
            break;
          end = this.buffer.indexOf('"', end + 1);
        }
      }
      const qb = this.buffer.substring(0, end);
      let nl = qb.indexOf(`
`, this.pos);
      if (nl !== -1) {
        while (nl !== -1) {
          const cs = this.continueScalar(nl + 1);
          if (cs === -1)
            break;
          nl = qb.indexOf(`
`, cs);
        }
        if (nl !== -1) {
          end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
        }
      }
      if (end === -1) {
        if (!this.atEnd)
          return this.setNext("quoted-scalar");
        end = this.buffer.length;
      }
      yield* this.pushToIndex(end + 1, false);
      return this.flowLevel ? "flow" : "doc";
    }
    *parseBlockScalarHeader() {
      this.blockScalarIndent = -1;
      this.blockScalarKeep = false;
      let i = this.pos;
      while (true) {
        const ch = this.buffer[++i];
        if (ch === "+")
          this.blockScalarKeep = true;
        else if (ch > "0" && ch <= "9")
          this.blockScalarIndent = Number(ch) - 1;
        else if (ch !== "-")
          break;
      }
      return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
    }
    *parseBlockScalar() {
      let nl = this.pos - 1;
      let indent = 0;
      let ch;
      loop:
        for (let i2 = this.pos;ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case `
`:
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === `
`)
                break;
            }
            default:
              break loop;
          }
        }
      if (!ch && !this.atEnd)
        return this.setNext("block-scalar");
      if (indent >= this.indentNext) {
        if (this.blockScalarIndent === -1)
          this.indentNext = indent;
        else {
          this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
        }
        do {
          const cs = this.continueScalar(nl + 1);
          if (cs === -1)
            break;
          nl = this.buffer.indexOf(`
`, cs);
        } while (nl !== -1);
        if (nl === -1) {
          if (!this.atEnd)
            return this.setNext("block-scalar");
          nl = this.buffer.length;
        }
      }
      let i = nl + 1;
      ch = this.buffer[i];
      while (ch === " ")
        ch = this.buffer[++i];
      if (ch === "\t") {
        while (ch === "\t" || ch === " " || ch === "\r" || ch === `
`)
          ch = this.buffer[++i];
        nl = i - 1;
      } else if (!this.blockScalarKeep) {
        do {
          let i2 = nl - 1;
          let ch2 = this.buffer[i2];
          if (ch2 === "\r")
            ch2 = this.buffer[--i2];
          const lastChar = i2;
          while (ch2 === " ")
            ch2 = this.buffer[--i2];
          if (ch2 === `
` && i2 >= this.pos && i2 + 1 + indent > lastChar)
            nl = i2;
          else
            break;
        } while (true);
      }
      yield cst.SCALAR;
      yield* this.pushToIndex(nl + 1, true);
      return yield* this.parseLineStart();
    }
    *parsePlainScalar() {
      const inFlow = this.flowLevel > 0;
      let end = this.pos - 1;
      let i = this.pos - 1;
      let ch;
      while (ch = this.buffer[++i]) {
        if (ch === ":") {
          const next = this.buffer[i + 1];
          if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
            break;
          end = i;
        } else if (isEmpty(ch)) {
          let next = this.buffer[i + 1];
          if (ch === "\r") {
            if (next === `
`) {
              i += 1;
              ch = `
`;
              next = this.buffer[i + 1];
            } else
              end = i;
          }
          if (next === "#" || inFlow && flowIndicatorChars.has(next))
            break;
          if (ch === `
`) {
            const cs = this.continueScalar(i + 1);
            if (cs === -1)
              break;
            i = Math.max(i, cs - 2);
          }
        } else {
          if (inFlow && flowIndicatorChars.has(ch))
            break;
          end = i;
        }
      }
      if (!ch && !this.atEnd)
        return this.setNext("plain-scalar");
      yield cst.SCALAR;
      yield* this.pushToIndex(end + 1, true);
      return inFlow ? "flow" : "doc";
    }
    *pushCount(n) {
      if (n > 0) {
        yield this.buffer.substr(this.pos, n);
        this.pos += n;
        return n;
      }
      return 0;
    }
    *pushToIndex(i, allowEmpty) {
      const s = this.buffer.slice(this.pos, i);
      if (s) {
        yield s;
        this.pos += s.length;
        return s.length;
      } else if (allowEmpty)
        yield "";
      return 0;
    }
    *pushIndicators() {
      switch (this.charAt(0)) {
        case "!":
          return (yield* this.pushTag()) + (yield* this.pushSpaces(true)) + (yield* this.pushIndicators());
        case "&":
          return (yield* this.pushUntil(isNotAnchorChar)) + (yield* this.pushSpaces(true)) + (yield* this.pushIndicators());
        case "-":
        case "?":
        case ":": {
          const inFlow = this.flowLevel > 0;
          const ch1 = this.charAt(1);
          if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
            if (!inFlow)
              this.indentNext = this.indentValue + 1;
            else if (this.flowKey)
              this.flowKey = false;
            return (yield* this.pushCount(1)) + (yield* this.pushSpaces(true)) + (yield* this.pushIndicators());
          }
        }
      }
      return 0;
    }
    *pushTag() {
      if (this.charAt(1) === "<") {
        let i = this.pos + 2;
        let ch = this.buffer[i];
        while (!isEmpty(ch) && ch !== ">")
          ch = this.buffer[++i];
        return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
      } else {
        let i = this.pos + 1;
        let ch = this.buffer[i];
        while (ch) {
          if (tagChars.has(ch))
            ch = this.buffer[++i];
          else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
            ch = this.buffer[i += 3];
          } else
            break;
        }
        return yield* this.pushToIndex(i, false);
      }
    }
    *pushNewline() {
      const ch = this.buffer[this.pos];
      if (ch === `
`)
        return yield* this.pushCount(1);
      else if (ch === "\r" && this.charAt(1) === `
`)
        return yield* this.pushCount(2);
      else
        return 0;
    }
    *pushSpaces(allowTabs) {
      let i = this.pos - 1;
      let ch;
      do {
        ch = this.buffer[++i];
      } while (ch === " " || allowTabs && ch === "\t");
      const n = i - this.pos;
      if (n > 0) {
        yield this.buffer.substr(this.pos, n);
        this.pos = i;
      }
      return n;
    }
    *pushUntil(test) {
      let i = this.pos;
      let ch = this.buffer[i];
      while (!test(ch))
        ch = this.buffer[++i];
      return yield* this.pushToIndex(i, false);
    }
  }
  exports.Lexer = Lexer;
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS((exports) => {
  class LineCounter {
    constructor() {
      this.lineStarts = [];
      this.addNewLine = (offset) => this.lineStarts.push(offset);
      this.linePos = (offset) => {
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
          const mid = low + high >> 1;
          if (this.lineStarts[mid] < offset)
            low = mid + 1;
          else
            high = mid;
        }
        if (this.lineStarts[low] === offset)
          return { line: low + 1, col: 1 };
        if (low === 0)
          return { line: 0, col: offset };
        const start = this.lineStarts[low - 1];
        return { line: low, col: offset - start + 1 };
      };
    }
  }
  exports.LineCounter = LineCounter;
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS((exports) => {
  var node_process = __require("process");
  var cst = require_cst();
  var lexer = require_lexer();
  function includesToken(list, type) {
    for (let i = 0;i < list.length; ++i)
      if (list[i].type === type)
        return true;
    return false;
  }
  function findNonEmptyIndex(list) {
    for (let i = 0;i < list.length; ++i) {
      switch (list[i].type) {
        case "space":
        case "comment":
        case "newline":
          break;
        default:
          return i;
      }
    }
    return -1;
  }
  function isFlowToken(token) {
    switch (token?.type) {
      case "alias":
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
      case "flow-collection":
        return true;
      default:
        return false;
    }
  }
  function getPrevProps(parent) {
    switch (parent.type) {
      case "document":
        return parent.start;
      case "block-map": {
        const it = parent.items[parent.items.length - 1];
        return it.sep ?? it.start;
      }
      case "block-seq":
        return parent.items[parent.items.length - 1].start;
      default:
        return [];
    }
  }
  function getFirstKeyStartProps(prev) {
    if (prev.length === 0)
      return [];
    let i = prev.length;
    loop:
      while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
    while (prev[++i]?.type === "space") {}
    return prev.splice(i, prev.length);
  }
  function fixFlowSeqItems(fc) {
    if (fc.start.type === "flow-seq-start") {
      for (const it of fc.items) {
        if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
          if (it.key)
            it.value = it.key;
          delete it.key;
          if (isFlowToken(it.value)) {
            if (it.value.end)
              Array.prototype.push.apply(it.value.end, it.sep);
            else
              it.value.end = it.sep;
          } else
            Array.prototype.push.apply(it.start, it.sep);
          delete it.sep;
        }
      }
    }
  }

  class Parser {
    constructor(onNewLine) {
      this.atNewLine = true;
      this.atScalar = false;
      this.indent = 0;
      this.offset = 0;
      this.onKeyLine = false;
      this.stack = [];
      this.source = "";
      this.type = "";
      this.lexer = new lexer.Lexer;
      this.onNewLine = onNewLine;
    }
    *parse(source, incomplete = false) {
      if (this.onNewLine && this.offset === 0)
        this.onNewLine(0);
      for (const lexeme of this.lexer.lex(source, incomplete))
        yield* this.next(lexeme);
      if (!incomplete)
        yield* this.end();
    }
    *next(source) {
      this.source = source;
      if (node_process.env.LOG_TOKENS)
        console.log("|", cst.prettyToken(source));
      if (this.atScalar) {
        this.atScalar = false;
        yield* this.step();
        this.offset += source.length;
        return;
      }
      const type = cst.tokenType(source);
      if (!type) {
        const message = `Not a YAML token: ${source}`;
        yield* this.pop({ type: "error", offset: this.offset, message, source });
        this.offset += source.length;
      } else if (type === "scalar") {
        this.atNewLine = false;
        this.atScalar = true;
        this.type = "scalar";
      } else {
        this.type = type;
        yield* this.step();
        switch (type) {
          case "newline":
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine)
              this.onNewLine(this.offset + source.length);
            break;
          case "space":
            if (this.atNewLine && source[0] === " ")
              this.indent += source.length;
            break;
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
            if (this.atNewLine)
              this.indent += source.length;
            break;
          case "doc-mode":
          case "flow-error-end":
            return;
          default:
            this.atNewLine = false;
        }
        this.offset += source.length;
      }
    }
    *end() {
      while (this.stack.length > 0)
        yield* this.pop();
    }
    get sourceToken() {
      const st = {
        type: this.type,
        offset: this.offset,
        indent: this.indent,
        source: this.source
      };
      return st;
    }
    *step() {
      const top = this.peek(1);
      if (this.type === "doc-end" && top?.type !== "doc-end") {
        while (this.stack.length > 0)
          yield* this.pop();
        this.stack.push({
          type: "doc-end",
          offset: this.offset,
          source: this.source
        });
        return;
      }
      if (!top)
        return yield* this.stream();
      switch (top.type) {
        case "document":
          return yield* this.document(top);
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return yield* this.scalar(top);
        case "block-scalar":
          return yield* this.blockScalar(top);
        case "block-map":
          return yield* this.blockMap(top);
        case "block-seq":
          return yield* this.blockSequence(top);
        case "flow-collection":
          return yield* this.flowCollection(top);
        case "doc-end":
          return yield* this.documentEnd(top);
      }
      yield* this.pop();
    }
    peek(n) {
      return this.stack[this.stack.length - n];
    }
    *pop(error) {
      const token = error ?? this.stack.pop();
      if (!token) {
        const message = "Tried to pop an empty stack";
        yield { type: "error", offset: this.offset, source: "", message };
      } else if (this.stack.length === 0) {
        yield token;
      } else {
        const top = this.peek(1);
        if (token.type === "block-scalar") {
          token.indent = "indent" in top ? top.indent : 0;
        } else if (token.type === "flow-collection" && top.type === "document") {
          token.indent = 0;
        }
        if (token.type === "flow-collection")
          fixFlowSeqItems(token);
        switch (top.type) {
          case "document":
            top.value = token;
            break;
          case "block-scalar":
            top.props.push(token);
            break;
          case "block-map": {
            const it = top.items[top.items.length - 1];
            if (it.value) {
              top.items.push({ start: [], key: token, sep: [] });
              this.onKeyLine = true;
              return;
            } else if (it.sep) {
              it.value = token;
            } else {
              Object.assign(it, { key: token, sep: [] });
              this.onKeyLine = !it.explicitKey;
              return;
            }
            break;
          }
          case "block-seq": {
            const it = top.items[top.items.length - 1];
            if (it.value)
              top.items.push({ start: [], value: token });
            else
              it.value = token;
            break;
          }
          case "flow-collection": {
            const it = top.items[top.items.length - 1];
            if (!it || it.value)
              top.items.push({ start: [], key: token, sep: [] });
            else if (it.sep)
              it.value = token;
            else
              Object.assign(it, { key: token, sep: [] });
            return;
          }
          default:
            yield* this.pop();
            yield* this.pop(token);
        }
        if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
          const last = token.items[token.items.length - 1];
          if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
            if (top.type === "document")
              top.end = last.start;
            else
              top.items.push({ start: last.start });
            token.items.splice(-1, 1);
          }
        }
      }
    }
    *stream() {
      switch (this.type) {
        case "directive-line":
          yield { type: "directive", offset: this.offset, source: this.source };
          return;
        case "byte-order-mark":
        case "space":
        case "comment":
        case "newline":
          yield this.sourceToken;
          return;
        case "doc-mode":
        case "doc-start": {
          const doc = {
            type: "document",
            offset: this.offset,
            start: []
          };
          if (this.type === "doc-start")
            doc.start.push(this.sourceToken);
          this.stack.push(doc);
          return;
        }
      }
      yield {
        type: "error",
        offset: this.offset,
        message: `Unexpected ${this.type} token in YAML stream`,
        source: this.source
      };
    }
    *document(doc) {
      if (doc.value)
        return yield* this.lineEnd(doc);
      switch (this.type) {
        case "doc-start": {
          if (findNonEmptyIndex(doc.start) !== -1) {
            yield* this.pop();
            yield* this.step();
          } else
            doc.start.push(this.sourceToken);
          return;
        }
        case "anchor":
        case "tag":
        case "space":
        case "comment":
        case "newline":
          doc.start.push(this.sourceToken);
          return;
      }
      const bv = this.startBlockValue(doc);
      if (bv)
        this.stack.push(bv);
      else {
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML document`,
          source: this.source
        };
      }
    }
    *scalar(scalar) {
      if (this.type === "map-value-ind") {
        const prev = getPrevProps(this.peek(2));
        const start = getFirstKeyStartProps(prev);
        let sep;
        if (scalar.end) {
          sep = scalar.end;
          sep.push(this.sourceToken);
          delete scalar.end;
        } else
          sep = [this.sourceToken];
        const map = {
          type: "block-map",
          offset: scalar.offset,
          indent: scalar.indent,
          items: [{ start, key: scalar, sep }]
        };
        this.onKeyLine = true;
        this.stack[this.stack.length - 1] = map;
      } else
        yield* this.lineEnd(scalar);
    }
    *blockScalar(scalar) {
      switch (this.type) {
        case "space":
        case "comment":
        case "newline":
          scalar.props.push(this.sourceToken);
          return;
        case "scalar":
          scalar.source = this.source;
          this.atNewLine = true;
          this.indent = 0;
          if (this.onNewLine) {
            let nl = this.source.indexOf(`
`) + 1;
            while (nl !== 0) {
              this.onNewLine(this.offset + nl);
              nl = this.source.indexOf(`
`, nl) + 1;
            }
          }
          yield* this.pop();
          break;
        default:
          yield* this.pop();
          yield* this.step();
      }
    }
    *blockMap(map) {
      const it = map.items[map.items.length - 1];
      switch (this.type) {
        case "newline":
          this.onKeyLine = false;
          if (it.value) {
            const end = "end" in it.value ? it.value.end : undefined;
            const last = Array.isArray(end) ? end[end.length - 1] : undefined;
            if (last?.type === "comment")
              end?.push(this.sourceToken);
            else
              map.items.push({ start: [this.sourceToken] });
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            it.start.push(this.sourceToken);
          }
          return;
        case "space":
        case "comment":
          if (it.value) {
            map.items.push({ start: [this.sourceToken] });
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            if (this.atIndentedComment(it.start, map.indent)) {
              const prev = map.items[map.items.length - 2];
              const end = prev?.value?.end;
              if (Array.isArray(end)) {
                Array.prototype.push.apply(end, it.start);
                end.push(this.sourceToken);
                map.items.pop();
                return;
              }
            }
            it.start.push(this.sourceToken);
          }
          return;
      }
      if (this.indent >= map.indent) {
        const atMapIndent = !this.onKeyLine && this.indent === map.indent;
        const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
        let start = [];
        if (atNextItem && it.sep && !it.value) {
          const nl = [];
          for (let i = 0;i < it.sep.length; ++i) {
            const st = it.sep[i];
            switch (st.type) {
              case "newline":
                nl.push(i);
                break;
              case "space":
                break;
              case "comment":
                if (st.indent > map.indent)
                  nl.length = 0;
                break;
              default:
                nl.length = 0;
            }
          }
          if (nl.length >= 2)
            start = it.sep.splice(nl[1]);
        }
        switch (this.type) {
          case "anchor":
          case "tag":
            if (atNextItem || it.value) {
              start.push(this.sourceToken);
              map.items.push({ start });
              this.onKeyLine = true;
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "explicit-key-ind":
            if (!it.sep && !it.explicitKey) {
              it.start.push(this.sourceToken);
              it.explicitKey = true;
            } else if (atNextItem || it.value) {
              start.push(this.sourceToken);
              map.items.push({ start, explicitKey: true });
            } else {
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: [this.sourceToken], explicitKey: true }]
              });
            }
            this.onKeyLine = true;
            return;
          case "map-value-ind":
            if (it.explicitKey) {
              if (!it.sep) {
                if (includesToken(it.start, "newline")) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else {
                  const start2 = getFirstKeyStartProps(it.start);
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                  });
                }
              } else if (it.value) {
                map.items.push({ start: [], key: null, sep: [this.sourceToken] });
              } else if (includesToken(it.sep, "map-value-ind")) {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start, key: null, sep: [this.sourceToken] }]
                });
              } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                const start2 = getFirstKeyStartProps(it.start);
                const key = it.key;
                const sep = it.sep;
                sep.push(this.sourceToken);
                delete it.key;
                delete it.sep;
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: start2, key, sep }]
                });
              } else if (start.length > 0) {
                it.sep = it.sep.concat(start, this.sourceToken);
              } else {
                it.sep.push(this.sourceToken);
              }
            } else {
              if (!it.sep) {
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              } else if (it.value || atNextItem) {
                map.items.push({ start, key: null, sep: [this.sourceToken] });
              } else if (includesToken(it.sep, "map-value-ind")) {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [], key: null, sep: [this.sourceToken] }]
                });
              } else {
                it.sep.push(this.sourceToken);
              }
            }
            this.onKeyLine = true;
            return;
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar": {
            const fs = this.flowScalar(this.type);
            if (atNextItem || it.value) {
              map.items.push({ start, key: fs, sep: [] });
              this.onKeyLine = true;
            } else if (it.sep) {
              this.stack.push(fs);
            } else {
              Object.assign(it, { key: fs, sep: [] });
              this.onKeyLine = true;
            }
            return;
          }
          default: {
            const bv = this.startBlockValue(map);
            if (bv) {
              if (bv.type === "block-seq") {
                if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                  yield* this.pop({
                    type: "error",
                    offset: this.offset,
                    message: "Unexpected block-seq-ind on same line with key",
                    source: this.source
                  });
                  return;
                }
              } else if (atMapIndent) {
                map.items.push({ start });
              }
              this.stack.push(bv);
              return;
            }
          }
        }
      }
      yield* this.pop();
      yield* this.step();
    }
    *blockSequence(seq) {
      const it = seq.items[seq.items.length - 1];
      switch (this.type) {
        case "newline":
          if (it.value) {
            const end = "end" in it.value ? it.value.end : undefined;
            const last = Array.isArray(end) ? end[end.length - 1] : undefined;
            if (last?.type === "comment")
              end?.push(this.sourceToken);
            else
              seq.items.push({ start: [this.sourceToken] });
          } else
            it.start.push(this.sourceToken);
          return;
        case "space":
        case "comment":
          if (it.value)
            seq.items.push({ start: [this.sourceToken] });
          else {
            if (this.atIndentedComment(it.start, seq.indent)) {
              const prev = seq.items[seq.items.length - 2];
              const end = prev?.value?.end;
              if (Array.isArray(end)) {
                Array.prototype.push.apply(end, it.start);
                end.push(this.sourceToken);
                seq.items.pop();
                return;
              }
            }
            it.start.push(this.sourceToken);
          }
          return;
        case "anchor":
        case "tag":
          if (it.value || this.indent <= seq.indent)
            break;
          it.start.push(this.sourceToken);
          return;
        case "seq-item-ind":
          if (this.indent !== seq.indent)
            break;
          if (it.value || includesToken(it.start, "seq-item-ind"))
            seq.items.push({ start: [this.sourceToken] });
          else
            it.start.push(this.sourceToken);
          return;
      }
      if (this.indent > seq.indent) {
        const bv = this.startBlockValue(seq);
        if (bv) {
          this.stack.push(bv);
          return;
        }
      }
      yield* this.pop();
      yield* this.step();
    }
    *flowCollection(fc) {
      const it = fc.items[fc.items.length - 1];
      if (this.type === "flow-error-end") {
        let top;
        do {
          yield* this.pop();
          top = this.peek(1);
        } while (top?.type === "flow-collection");
      } else if (fc.end.length === 0) {
        switch (this.type) {
          case "comma":
          case "explicit-key-ind":
            if (!it || it.sep)
              fc.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
          case "map-value-ind":
            if (!it || it.value)
              fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
            else if (it.sep)
              it.sep.push(this.sourceToken);
            else
              Object.assign(it, { key: null, sep: [this.sourceToken] });
            return;
          case "space":
          case "comment":
          case "newline":
          case "anchor":
          case "tag":
            if (!it || it.value)
              fc.items.push({ start: [this.sourceToken] });
            else if (it.sep)
              it.sep.push(this.sourceToken);
            else
              it.start.push(this.sourceToken);
            return;
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar": {
            const fs = this.flowScalar(this.type);
            if (!it || it.value)
              fc.items.push({ start: [], key: fs, sep: [] });
            else if (it.sep)
              this.stack.push(fs);
            else
              Object.assign(it, { key: fs, sep: [] });
            return;
          }
          case "flow-map-end":
          case "flow-seq-end":
            fc.end.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(fc);
        if (bv)
          this.stack.push(bv);
        else {
          yield* this.pop();
          yield* this.step();
        }
      } else {
        const parent = this.peek(2);
        if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
          yield* this.pop();
          yield* this.step();
        } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          fixFlowSeqItems(fc);
          const sep = fc.end.splice(1, fc.end.length);
          sep.push(this.sourceToken);
          const map = {
            type: "block-map",
            offset: fc.offset,
            indent: fc.indent,
            items: [{ start, key: fc, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else {
          yield* this.lineEnd(fc);
        }
      }
    }
    flowScalar(type) {
      if (this.onNewLine) {
        let nl = this.source.indexOf(`
`) + 1;
        while (nl !== 0) {
          this.onNewLine(this.offset + nl);
          nl = this.source.indexOf(`
`, nl) + 1;
        }
      }
      return {
        type,
        offset: this.offset,
        indent: this.indent,
        source: this.source
      };
    }
    startBlockValue(parent) {
      switch (this.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return this.flowScalar(this.type);
        case "block-scalar-header":
          return {
            type: "block-scalar",
            offset: this.offset,
            indent: this.indent,
            props: [this.sourceToken],
            source: ""
          };
        case "flow-map-start":
        case "flow-seq-start":
          return {
            type: "flow-collection",
            offset: this.offset,
            indent: this.indent,
            start: this.sourceToken,
            items: [],
            end: []
          };
        case "seq-item-ind":
          return {
            type: "block-seq",
            offset: this.offset,
            indent: this.indent,
            items: [{ start: [this.sourceToken] }]
          };
        case "explicit-key-ind": {
          this.onKeyLine = true;
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          start.push(this.sourceToken);
          return {
            type: "block-map",
            offset: this.offset,
            indent: this.indent,
            items: [{ start, explicitKey: true }]
          };
        }
        case "map-value-ind": {
          this.onKeyLine = true;
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          return {
            type: "block-map",
            offset: this.offset,
            indent: this.indent,
            items: [{ start, key: null, sep: [this.sourceToken] }]
          };
        }
      }
      return null;
    }
    atIndentedComment(start, indent) {
      if (this.type !== "comment")
        return false;
      if (this.indent <= indent)
        return false;
      return start.every((st) => st.type === "newline" || st.type === "space");
    }
    *documentEnd(docEnd) {
      if (this.type !== "doc-mode") {
        if (docEnd.end)
          docEnd.end.push(this.sourceToken);
        else
          docEnd.end = [this.sourceToken];
        if (this.type === "newline")
          yield* this.pop();
      }
    }
    *lineEnd(token) {
      switch (this.type) {
        case "comma":
        case "doc-start":
        case "doc-end":
        case "flow-seq-end":
        case "flow-map-end":
        case "map-value-ind":
          yield* this.pop();
          yield* this.step();
          break;
        case "newline":
          this.onKeyLine = false;
        case "space":
        case "comment":
        default:
          if (token.end)
            token.end.push(this.sourceToken);
          else
            token.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
      }
    }
  }
  exports.Parser = Parser;
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS((exports) => {
  var composer = require_composer();
  var Document = require_Document();
  var errors = require_errors();
  var log = require_log();
  var identity = require_identity();
  var lineCounter = require_line_counter();
  var parser = require_parser();
  function parseOptions(options) {
    const prettyErrors = options.prettyErrors !== false;
    const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter || null;
    return { lineCounter: lineCounter$1, prettyErrors };
  }
  function parseAllDocuments(source, options = {}) {
    const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
    const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
    const composer$1 = new composer.Composer(options);
    const docs = Array.from(composer$1.compose(parser$1.parse(source)));
    if (prettyErrors && lineCounter2)
      for (const doc of docs) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
    if (docs.length > 0)
      return docs;
    return Object.assign([], { empty: true }, composer$1.streamInfo());
  }
  function parseDocument(source, options = {}) {
    const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
    const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
    const composer$1 = new composer.Composer(options);
    let doc = null;
    for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
      if (!doc)
        doc = _doc;
      else if (doc.options.logLevel !== "silent") {
        doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
        break;
      }
    }
    if (prettyErrors && lineCounter2) {
      doc.errors.forEach(errors.prettifyError(source, lineCounter2));
      doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
    }
    return doc;
  }
  function parse(src, reviver, options) {
    let _reviver = undefined;
    if (typeof reviver === "function") {
      _reviver = reviver;
    } else if (options === undefined && reviver && typeof reviver === "object") {
      options = reviver;
    }
    const doc = parseDocument(src, options);
    if (!doc)
      return null;
    doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
    if (doc.errors.length > 0) {
      if (doc.options.logLevel !== "silent")
        throw doc.errors[0];
      else
        doc.errors = [];
    }
    return doc.toJS(Object.assign({ reviver: _reviver }, options));
  }
  function stringify(value, replacer, options) {
    let _replacer = null;
    if (typeof replacer === "function" || Array.isArray(replacer)) {
      _replacer = replacer;
    } else if (options === undefined && replacer) {
      options = replacer;
    }
    if (typeof options === "string")
      options = options.length;
    if (typeof options === "number") {
      const indent = Math.round(options);
      options = indent < 1 ? undefined : indent > 8 ? { indent: 8 } : { indent };
    }
    if (value === undefined) {
      const { keepUndefined } = options ?? replacer ?? {};
      if (!keepUndefined)
        return;
    }
    if (identity.isDocument(value) && !_replacer)
      return value.toString(options);
    return new Document.Document(value, _replacer, options).toString(options);
  }
  exports.parse = parse;
  exports.parseAllDocuments = parseAllDocuments;
  exports.parseDocument = parseDocument;
  exports.stringify = stringify;
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS((exports) => {
  var composer = require_composer();
  var Document = require_Document();
  var Schema = require_Schema();
  var errors = require_errors();
  var Alias = require_Alias();
  var identity = require_identity();
  var Pair = require_Pair();
  var Scalar = require_Scalar();
  var YAMLMap = require_YAMLMap();
  var YAMLSeq = require_YAMLSeq();
  var cst = require_cst();
  var lexer = require_lexer();
  var lineCounter = require_line_counter();
  var parser = require_parser();
  var publicApi = require_public_api();
  var visit = require_visit();
  exports.Composer = composer.Composer;
  exports.Document = Document.Document;
  exports.Schema = Schema.Schema;
  exports.YAMLError = errors.YAMLError;
  exports.YAMLParseError = errors.YAMLParseError;
  exports.YAMLWarning = errors.YAMLWarning;
  exports.Alias = Alias.Alias;
  exports.isAlias = identity.isAlias;
  exports.isCollection = identity.isCollection;
  exports.isDocument = identity.isDocument;
  exports.isMap = identity.isMap;
  exports.isNode = identity.isNode;
  exports.isPair = identity.isPair;
  exports.isScalar = identity.isScalar;
  exports.isSeq = identity.isSeq;
  exports.Pair = Pair.Pair;
  exports.Scalar = Scalar.Scalar;
  exports.YAMLMap = YAMLMap.YAMLMap;
  exports.YAMLSeq = YAMLSeq.YAMLSeq;
  exports.CST = cst;
  exports.Lexer = lexer.Lexer;
  exports.LineCounter = lineCounter.LineCounter;
  exports.Parser = parser.Parser;
  exports.parse = publicApi.parse;
  exports.parseAllDocuments = publicApi.parseAllDocuments;
  exports.parseDocument = publicApi.parseDocument;
  exports.stringify = publicApi.stringify;
  exports.visit = visit.visit;
  exports.visitAsync = visit.visitAsync;
});

// node_modules/irises-extension-sdk/src/logger.ts
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

// node_modules/irises-extension-sdk/src/plugin/context.ts
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/config-template.ts
var DEFAULT_REMOTE_EXEC_YAML = `# remote-exec 配置
#
# 让 AI 像在远端机器上原生运行本项目一样使用工具：
# AI 调用 list_files / read_file / write_file / shell ... 时，
# 后台自动翻译成等价的远端操作，并把结果整理回工具原有的 JSON 形态。
# AI 全程无感。
#
# 目标服务器写在同目录下的 remote_exec_servers.yaml 中。

# 是否启用本扩展（false 时所有工具静默走本地）
enabled: false

# 默认活动环境（启动时使用）：
#   local        本机执行（不走 SSH）
#   <服务器别名> 对应 remote_exec_servers.yaml 中 servers.<别名>
defaultEnvironment: local

# 是否向 AI 暴露 switch_environment 工具，让 AI 自主切换环境
# 关闭后只能由配置文件指定
exposeSwitchTool: true

# 远端工作目录（cwd）：所有翻译后的命令默认在此目录下执行。
# 留空则使用登录用户的 home。可在 servers 配置里按服务器单独覆写。
remoteWorkdir: ~

ssh:
  reuseConnection: true
  connectTimeoutMs: 10000
  keepAliveSec: 30
  commandTimeoutMs: 0
  # 远端进程退出后，等待 stdout/stderr 排空的最长时间（毫秒）
  # 解决 nohup/& 启动后台进程时 SSH channel 不自然关闭、工具调用挂起的问题
  # 默认 200，正常命令几乎无感；设为 0 会退化为旧行为，不推荐
  postExitDrainMs: 200
`;
var DEFAULT_REMOTE_EXEC_SERVERS_YAML = `# remote-exec 服务器清单
#
# 推荐 YAML 格式，走 Iris Extension SDK 配置接口：
#   - 插件首次启动会通过 ctx.ensureConfigFile() 释放本文件
#   - 插件读取时通过 ctx.readConfigSection('remote_exec_servers')
#   - 修改后支持配置热重载
#
# servers 是一个 map：key 是环境名/别名，value 是 SSH 连接信息。
# AI 会通过 switch_environment 工具看到这些环境名。
#
# 字段：
#   hostName      实际主机名 / IP（必填）
#   port          SSH 端口（默认 22）
#   user          登录用户名
#   identityFile  私钥文件绝对路径
#   password      明文密码（与 identityFile 二选一；建议优先用密钥）
#   workdir       该服务器上的默认工作目录（覆盖 remote_exec.yaml 的 remoteWorkdir）
#   os            服务器操作系统（AI 可见，用于选择正确命令语法）: linux / windows / macos
#   description   AI 可见的环境描述（switch_environment 工具会展示）
#   transport     auto（默认）/ sftp / bash
#                 auto = 文件精确操作优先 SFTP，扫描/搜索/shell 走 bash
#                 sftp = 文件精确操作强制 SFTP（失败时报错）
#                 bash = 强制纯 bash，适配无 SFTP 的极简环境

servers:
  # cqa1:
  #   hostName: connect.cqa1.seetacloud.com
  #   port: 32768
  #   user: root
  #   identityFile: C:\\Users\\Lianues\\.ssh\\id_rsa
  #   workdir: /root/projects/myapp
  #   os: linux
  #   transport: auto
  #   description: GPU 训练机（A100 x 2）

  # nginx-prod:
  #   hostName: 203.0.113.1
  #   user: root
  #   identityFile: C:\\Users\\Lianues\\.ssh\\id_rsa_nginx_server
  #   workdir: /etc/nginx
  #   os: linux
  #   description: 生产环境 Nginx 节点

  # quick-pwd:
  #   hostName: 203.0.113.1
  #   user: lianuesss
  #   password: your_password_here
  #   transport: auto
  #   os: linux
  #   description: 临时账号（密码登录）
`;

// src/config.ts
var import_yaml = __toESM(require_dist(), 1);
var LOCAL_ENV = "local";
var DEFAULTS = {
  enabled: false,
  defaultEnvironment: LOCAL_ENV,
  exposeSwitchTool: true,
  remoteWorkdir: undefined,
  ssh: {
    reuseConnection: true,
    connectTimeoutMs: 1e4,
    keepAliveSec: 30,
    commandTimeoutMs: 0,
    postExitDrainMs: 200
  }
};
function parseRemoteExecConfig(raw) {
  if (!raw || typeof raw !== "object")
    return { ...DEFAULTS };
  const r = raw;
  const ssh = r.ssh && typeof r.ssh === "object" ? r.ssh : {};
  return {
    enabled: r.enabled === true,
    defaultEnvironment: typeof r.defaultEnvironment === "string" && r.defaultEnvironment.trim() ? r.defaultEnvironment.trim() : LOCAL_ENV,
    exposeSwitchTool: r.exposeSwitchTool !== false,
    remoteWorkdir: typeof r.remoteWorkdir === "string" && r.remoteWorkdir.trim() ? r.remoteWorkdir.trim() : undefined,
    ssh: {
      reuseConnection: ssh.reuseConnection !== false,
      connectTimeoutMs: toFiniteNumber(ssh.connectTimeoutMs, DEFAULTS.ssh.connectTimeoutMs),
      keepAliveSec: toFiniteNumber(ssh.keepAliveSec, DEFAULTS.ssh.keepAliveSec),
      commandTimeoutMs: toFiniteNumber(ssh.commandTimeoutMs, DEFAULTS.ssh.commandTimeoutMs),
      postExitDrainMs: toFiniteNumber(ssh.postExitDrainMs, DEFAULTS.ssh.postExitDrainMs)
    }
  };
}
function toFiniteNumber(v, def) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : def;
}

// src/ssh-config.ts
function parseServersSectionDetailed(raw) {
  const out = new Map;
  const warnings = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { servers: out, warnings };
  }
  const root = raw;
  const serversRaw = root.servers;
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) {
    warnings.push("缺少顶层 servers: map。");
    return { servers: out, warnings };
  }
  for (const [alias, value] of Object.entries(serversRaw)) {
    const parsed = parseServerEntry(alias, value);
    if (parsed.entry)
      out.set(parsed.entry.host, parsed.entry);
    else
      warnings.push(parsed.error ?? `服务器 ${alias} 配置无效。`);
  }
  return { servers: out, warnings };
}
function parseServerEntry(alias, value) {
  if (!alias)
    return { error: "服务器别名不能为空。" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: `服务器 ${alias} 必须是对象。` };
  }
  const obj = value;
  const hostName = stringField(obj.hostName) ?? stringField(obj.hostname) ?? stringField(obj.host);
  if (!hostName) {
    const keys = Object.keys(obj).join(", ") || "(无字段)";
    return { error: `服务器 ${alias} 缺少 hostName（也可写 hostname/host）。当前字段: ${keys}` };
  }
  const transportRaw = stringField(obj.transport)?.toLowerCase();
  const transport = transportRaw === "sftp" || transportRaw === "bash" || transportRaw === "auto" ? transportRaw : undefined;
  const port = numberField(obj.port) ?? 22;
  return {
    entry: {
      host: alias,
      hostName,
      port,
      user: stringField(obj.user),
      identityFile: stringField(obj.identityFile),
      password: stringField(obj.password),
      workdir: stringField(obj.workdir),
      os: stringField(obj.os),
      description: stringField(obj.description),
      transport
    }
  };
}
function stringField(v) {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function numberField(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0)
    return Math.floor(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number.parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n > 0)
      return n;
  }
  return;
}

// src/transport.ts
import { Client } from "ssh2";
import { promises as fs } from "node:fs";

class SshTransport {
  servers;
  sshCfg;
  logger;
  pool = new Map;
  constructor(servers, sshCfg, logger) {
    this.servers = servers;
    this.sshCfg = sshCfg;
    this.logger = logger;
  }
  getServer(alias) {
    const server = this.servers.get(alias);
    if (!server)
      throw new Error(`remote-exec: 未知服务器别名 "${alias}"`);
    return server;
  }
  getTransportMode(alias) {
    return this.getServer(alias).transport ?? "auto";
  }
  closeAll() {
    for (const [alias, conn] of this.pool) {
      try {
        conn.client.end();
      } catch {}
      this.logger?.info(`SSH 连接已关闭: ${alias}`);
    }
    this.pool.clear();
  }
  closeOne(alias) {
    const conn = this.pool.get(alias);
    if (!conn)
      return;
    try {
      conn.client.end();
    } catch {}
    this.pool.delete(alias);
  }
  async execCommand(alias, command, signal, input) {
    const server = this.getServer(alias);
    const client = await this.acquire(alias, server);
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let exitCode = null;
      let exitSignal;
      let timedOut = false;
      let timer;
      let drainTimer;
      let onAbort;
      let settled = false;
      let currentStream;
      const cleanup = () => {
        if (timer)
          clearTimeout(timer);
        if (drainTimer)
          clearTimeout(drainTimer);
        if (signal && onAbort)
          signal.removeEventListener("abort", onAbort);
      };
      const settle = (forceClose) => {
        if (settled)
          return;
        settled = true;
        cleanup();
        if (forceClose && currentStream) {
          try {
            currentStream.close?.();
          } catch {}
          try {
            currentStream.destroy?.();
          } catch {}
        }
        resolve({ stdout, stderr, exitCode, signal: exitSignal, timedOut });
      };
      client.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          cleanup();
          this.closeOne(alias);
          reject(err);
          return;
        }
        currentStream = stream;
        if (this.sshCfg.commandTimeoutMs > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            try {
              stream.signal("KILL");
            } catch {}
            try {
              stream.close();
            } catch {}
          }, this.sshCfg.commandTimeoutMs);
        }
        if (signal) {
          if (signal.aborted) {
            try {
              stream.close();
            } catch {}
          } else {
            onAbort = () => {
              try {
                stream.signal("INT");
              } catch {}
              try {
                stream.close();
              } catch {}
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }
        stream.on("close", (code, sig) => {
          if (exitCode === null && code !== null && code !== undefined)
            exitCode = code;
          if (!exitSignal && sig)
            exitSignal = sig;
          settle(false);
        }).on("exit", (code, sig) => {
          if (code !== null && code !== undefined)
            exitCode = code;
          if (sig)
            exitSignal = sig;
          if (!drainTimer && !settled) {
            const drainMs = this.sshCfg.postExitDrainMs;
            if (drainMs > 0) {
              drainTimer = setTimeout(() => settle(true), drainMs);
            } else {
              settle(true);
            }
          }
        }).on("error", (err2) => {
          stderr += `[stream-error] ${err2.message}
`;
          if (!drainTimer && !settled) {
            const drainMs = this.sshCfg.postExitDrainMs > 0 ? this.sshCfg.postExitDrainMs : 200;
            drainTimer = setTimeout(() => settle(true), drainMs);
          }
        }).on("data", (chunk) => {
          stdout += chunk.toString("utf8");
        });
        stream.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });
        stream.stderr.on("error", () => {});
        if (input !== undefined)
          stream.end(input);
        else
          stream.end();
      });
    });
  }
  async execStream(alias, command, signal) {
    const server = this.getServer(alias);
    const client = await this.acquire(alias, server);
    return new Promise((resolve, reject) => {
      let stderr = "";
      let exitCode = null;
      let exitSignal;
      let timedOut = false;
      let timer;
      let drainTimer;
      let onAbort;
      const cleanup = () => {
        if (timer)
          clearTimeout(timer);
        if (drainTimer)
          clearTimeout(drainTimer);
        if (signal && onAbort)
          signal.removeEventListener("abort", onAbort);
      };
      client.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          cleanup();
          this.closeOne(alias);
          reject(err);
          return;
        }
        if (this.sshCfg.commandTimeoutMs > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            try {
              stream.signal("KILL");
            } catch {}
            try {
              stream.close();
            } catch {}
          }, this.sshCfg.commandTimeoutMs);
        }
        if (signal) {
          if (signal.aborted) {
            try {
              stream.close();
            } catch {}
          } else {
            onAbort = () => {
              try {
                stream.signal("INT");
              } catch {}
              try {
                stream.close();
              } catch {}
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }
        const done = new Promise((resolveDone) => {
          let settled = false;
          const finishDone = (forceClose) => {
            if (settled)
              return;
            settled = true;
            cleanup();
            if (forceClose) {
              try {
                stream.close();
              } catch {}
              try {
                stream.destroy?.();
              } catch {}
            }
            resolveDone({ stdout: "", stderr, exitCode, signal: exitSignal, timedOut });
          };
          stream.on("close", (code, sig) => {
            if (exitCode === null && code !== null && code !== undefined)
              exitCode = code;
            if (!exitSignal && sig)
              exitSignal = sig;
            finishDone(false);
          });
          stream.on("exit", (code, sig) => {
            if (code !== null && code !== undefined)
              exitCode = code;
            if (sig)
              exitSignal = sig;
            if (!drainTimer && !settled) {
              const drainMs = this.sshCfg.postExitDrainMs;
              if (drainMs > 0)
                drainTimer = setTimeout(() => finishDone(true), drainMs);
              else
                finishDone(true);
            }
          });
          stream.on("error", (err2) => {
            stderr += `[stream-error] ${err2.message}
`;
            if (!drainTimer && !settled) {
              const drainMs = this.sshCfg.postExitDrainMs > 0 ? this.sshCfg.postExitDrainMs : 200;
              drainTimer = setTimeout(() => finishDone(true), drainMs);
            }
          });
          stream.stderr.on("data", (chunk) => {
            if (stderr.length < 64000)
              stderr += chunk.toString("utf8");
          });
          stream.stderr.on("error", () => {});
        });
        resolve({
          stdin: stream,
          stdout: stream,
          stderr: stream.stderr,
          done
        });
      });
    });
  }
  async getSftp(alias) {
    const server = this.getServer(alias);
    const conn = await this.acquireConnection(alias, server);
    if (conn.sftpUnavailable) {
      throw new Error(conn.sftpUnavailable);
    }
    if (!conn.sftp) {
      conn.sftp = new Promise((resolve, reject) => {
        conn.client.sftp((err, sftp) => {
          if (err) {
            conn.sftp = undefined;
            conn.sftpUnavailable = `SFTP 子系统不可用 (${alias}): ${err.message}`;
            reject(new Error(conn.sftpUnavailable));
            return;
          }
          resolve(sftp);
        });
      });
    }
    return conn.sftp;
  }
  async sftpReadFile(alias, remotePath) {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => err ? reject(err) : resolve(Buffer.isBuffer(data) ? data : Buffer.from(data)));
    });
  }
  async sftpWriteFile(alias, remotePath, data) {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, data, (err) => err ? reject(err) : resolve());
    });
  }
  async sftpReaddir(alias, remotePath) {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => err ? reject(err) : resolve(list));
    });
  }
  async sftpStat(alias, remotePath) {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, st) => err ? reject(err) : resolve(st));
    });
  }
  async sftpMkdir(alias, remotePath) {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => err ? reject(err) : resolve());
    });
  }
  async sftpUnlink(alias, remotePath) {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => err ? reject(err) : resolve());
    });
  }
  async sftpRmdir(alias, remotePath) {
    const sftp = await this.getSftp(alias);
    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve());
    });
  }
  async acquire(alias, server) {
    const conn = await this.acquireConnection(alias, server);
    return conn.client;
  }
  async acquireConnection(alias, server) {
    if (this.sshCfg.reuseConnection) {
      const existing = this.pool.get(alias);
      if (existing) {
        await existing.ready;
        return existing;
      }
    }
    const client = new Client;
    const conn = {
      client,
      ready: new Promise((resolve, reject) => {
        client.on("ready", () => {
          this.logger?.info(`SSH 连接已就绪: ${alias} (${server.user ?? ""}@${server.hostName}:${server.port})`);
          resolve();
        }).on("error", (err) => {
          this.logger?.warn(`SSH 连接错误 (${alias}): ${err.message}`);
          this.pool.delete(alias);
          reject(err);
        }).on("end", () => {
          this.pool.delete(alias);
        }).on("close", () => {
          this.pool.delete(alias);
        });
      })
    };
    if (this.sshCfg.reuseConnection)
      this.pool.set(alias, conn);
    const connectCfg = await buildConnectConfig(server, this.sshCfg);
    client.connect(connectCfg);
    try {
      await conn.ready;
    } catch (err) {
      this.pool.delete(alias);
      throw err;
    }
    return conn;
  }
}
async function buildConnectConfig(s, sshCfg) {
  const cfg = {
    host: s.hostName,
    port: s.port,
    username: s.user,
    readyTimeout: sshCfg.connectTimeoutMs,
    keepaliveInterval: sshCfg.keepAliveSec > 0 ? sshCfg.keepAliveSec * 1000 : 0
  };
  if (s.identityFile) {
    try {
      cfg.privateKey = await fs.readFile(s.identityFile);
    } catch (err) {
      throw new Error(`remote-exec: 无法读取 IdentityFile "${s.identityFile}" (Host=${s.host}): ${err.message}`);
    }
  } else if (s.password) {
    cfg.password = s.password;
  } else {
    throw new Error(`remote-exec: 服务器 "${s.host}" 既未配置 IdentityFile 也未配置 Password，无法认证`);
  }
  return cfg;
}

// src/environment.ts
class EnvironmentManager {
  api;
  getServers;
  getConfig;
  sessionCache = new Map;
  constructor(api, getServers, getConfig) {
    this.api = api;
    this.getServers = getServers;
    this.getConfig = getConfig;
  }
  getActive() {
    const sid = this.api.agentManager?.getActiveSessionId?.();
    if (!sid)
      return this.getConfig().defaultEnvironment ?? LOCAL_ENV;
    const cached = this.sessionCache.get(sid);
    if (cached) {
      if (cached === LOCAL_ENV || this.getServers().has(cached))
        return cached;
      this.sessionCache.set(sid, LOCAL_ENV);
      return LOCAL_ENV;
    }
    return this.getConfig().defaultEnvironment ?? LOCAL_ENV;
  }
  async ensureLoaded(sessionId) {
    if (this.sessionCache.has(sessionId))
      return;
    try {
      const meta = await this.api.storage.getMeta?.(sessionId);
      const stored = meta?.remoteExecEnvironment;
      if (stored && (stored === LOCAL_ENV || this.getServers().has(stored))) {
        this.sessionCache.set(sessionId, stored);
      }
    } catch {}
  }
  async setActive(name) {
    const previous = this.getActive();
    if (name !== LOCAL_ENV && !this.getServers().has(name)) {
      throw new Error(`未知环境 "${name}"。可用环境：${this.listEnvs().map((e) => e.name).join(", ")}`);
    }
    const sid = this.api.agentManager?.getActiveSessionId?.();
    if (sid) {
      this.sessionCache.set(sid, name);
      try {
        const meta = await this.api.storage.getMeta?.(sid);
        if (meta) {
          meta.remoteExecEnvironment = name;
          await this.api.storage.saveMeta?.(meta);
        }
      } catch {}
    }
    return { previous, current: name };
  }
  clearSession(sessionId) {
    this.sessionCache.delete(sessionId);
  }
  getActiveServer() {
    const name = this.getActive();
    if (name === LOCAL_ENV)
      return null;
    return this.getServers().get(name) ?? null;
  }
  listEnvs() {
    const list = [
      { name: LOCAL_ENV, isLocal: true, description: "本机（不通过 SSH，直接在本地执行所有工具）" }
    ];
    for (const s of this.getServers().values()) {
      list.push({
        name: s.host,
        isLocal: false,
        description: s.description ? `${s.description} (transport=${s.transport ?? "auto"})` : `transport=${s.transport ?? "auto"}`,
        os: s.os,
        hostName: s.hostName,
        user: s.user,
        workdir: s.workdir
      });
    }
    return list;
  }
}

// src/tools.ts
function buildSwitchEnvironmentTool(envMgr) {
  const envs = envMgr.listEnvs();
  const envNames = envs.map((e) => e.name);
  const lines = [];
  lines.push('切换"远程执行环境"。切换后，list_files / read_file / write_file / shell 等工具会自动在该环境上执行（远端 SSH / 本地）。');
  lines.push('如果用户明确指定了环境名，必须把该环境名放入 name 参数；例如 switch_environment({"name":"server1"})。');
  lines.push("");
  lines.push("当前可用环境：");
  for (const e of envs) {
    const tags = [
      e.isLocal ? "本地" : `${e.user ?? "?"}@${e.hostName ?? "?"}`,
      e.os ? `OS=${e.os}` : null,
      e.workdir ? `workdir=${e.workdir}` : null,
      e.description ?? null
    ].filter(Boolean).join(" · ");
    lines.push(`  - ${e.name}: ${tags}`);
  }
  lines.push("");
  lines.push("注意：当前环境会在调用本工具后切换；工具返回值会告诉你切换后的 current。");
  return {
    declaration: {
      name: "switch_environment",
      description: lines.join(`
`),
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: `要切换到的环境名（local 表示本机）。可选值：${envNames.join(" | ")}`,
            enum: envNames
          }
        },
        required: ["name"]
      }
    },
    handler: async (args) => {
      const name = args.name?.trim();
      if (!name)
        throw new Error("switch_environment: name 不能为空");
      const { previous, current } = await envMgr.setActive(name);
      const after = envMgr.listEnvs().find((e) => e.name === current);
      return {
        success: true,
        previous,
        current,
        environment: after,
        message: previous === current ? `已经在环境 "${current}"，未发生变化。` : `已从 "${previous}" 切换到 "${current}"。后续工具调用将自动在此环境执行。`
      };
    }
  };
}

// src/transfer-tool.ts
import * as fs2 from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// src/remote-shell.ts
function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function withCwd(command, cwd) {
  if (!cwd)
    return command;
  return `cd ${shQuote(cwd)} && ${command}`;
}

// src/transfer-tool.ts
var TRANSFER_FILES_TOOL_NAME = "transfer_files";
function buildTransferFilesTool(envMgr, getTransport) {
  const envs = envMgr.listEnvs();
  const envNames = envs.map((e) => e.name);
  return {
    declaration: {
      name: TRANSFER_FILES_TOOL_NAME,
      description: [
        "在本地与远端环境之间传输文件或目录。支持 local ↔ remote、remote ↔ remote、local ↔ local。",
        "注意：remote ↔ remote 传输会通过当前本地 Iris 实例中转。",
        "路径必须使用全路径/绝对路径：本地如 C:\\path\\file 或 /home/me/file，远端如 /root/file。",
        "路径以 / 或 \\ 结尾表示目录；否则表示文件。type=auto 时也会 stat 源路径自动判断。",
        "传目录时，toPath 表示目标目录本身，例如 fromPath=/data/app/ toPath=/backup/app/。",
        "默认 overwrite=false，目标存在会失败；需要覆盖时显式设置 overwrite=true。",
        "文件写入采用临时文件 + 校验 + rename 的原子提交方式；失败会尽力清理临时文件。"
      ].join(`
`),
      parameters: {
        type: "object",
        properties: {
          transfers: {
            type: "array",
            description: "批量传输任务数组。若提供 transfers，则忽略单条快捷字段。",
            items: {
              type: "object",
              properties: transferProperties(envNames),
              required: ["fromEnvironment", "fromPath", "toEnvironment", "toPath"]
            }
          },
          ...transferProperties(envNames),
          verify: {
            type: "string",
            enum: ["none", "size"],
            description: "校验模式。none=不校验；size=比较源/目标文件大小（默认）。目录逐文件校验。"
          }
        }
      }
    },
    handler: async (args, context) => {
      const items = normalizeTransfers(args);
      if (items.length === 0) {
        throw new Error("transfer_files: 请提供 transfers 数组，或提供 fromEnvironment/fromPath/toEnvironment/toPath 单条参数。");
      }
      const verify = args.verify === "none" ? "none" : "size";
      const results = [];
      let successCount = 0;
      let failCount = 0;
      for (let i = 0;i < items.length; i++) {
        const started = Date.now();
        const item = items[i];
        try {
          const result = await runTransfer(item, verify, envMgr, getTransport(), context, i);
          results.push({ ...result, durationMs: Date.now() - started });
          successCount++;
        } catch (err) {
          results.push({
            success: false,
            index: i,
            type: item.type,
            from: { environment: item.fromEnvironment, path: item.fromPath },
            to: { environment: item.toEnvironment, path: item.toPath },
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - started
          });
          failCount++;
        }
      }
      return { results, successCount, failCount, totalCount: items.length };
    }
  };
}
function transferProperties(envNames) {
  return {
    fromEnvironment: {
      type: "string",
      enum: envNames,
      description: `源环境。可选值：${envNames.join(" | ")}`
    },
    fromPath: {
      type: "string",
      description: "源路径，必须是全路径/绝对路径。目录建议以 / 或 \\ 结尾。"
    },
    toEnvironment: {
      type: "string",
      enum: envNames,
      description: `目标环境。可选值：${envNames.join(" | ")}`
    },
    toPath: {
      type: "string",
      description: "目标路径，必须是全路径/绝路径。传目录时表示目标目录本身。"
    },
    type: {
      type: "string",
      enum: ["auto", "file", "directory"],
      description: "传输类型。auto 会根据 fromPath 尾部斜杠和源路径 stat 自动判断。默认 auto。"
    },
    overwrite: {
      type: "boolean",
      description: "目标存在时是否覆盖。默认 false。"
    },
    createDirs: {
      type: "boolean",
      description: "是否自动创建目标父目录/目标目录。默认 true。"
    }
  };
}
function normalizeTransfers(args) {
  const rawList = Array.isArray(args.transfers) && args.transfers.length > 0 ? args.transfers : [args];
  const out = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      continue;
    const obj = raw;
    const fromEnvironment = str(obj.fromEnvironment);
    const fromPath = str(obj.fromPath);
    const toEnvironment = str(obj.toEnvironment);
    const toPath = str(obj.toPath);
    if (!fromEnvironment || !fromPath || !toEnvironment || !toPath)
      continue;
    const typeRaw = str(obj.type);
    out.push({
      fromEnvironment,
      fromPath,
      toEnvironment,
      toPath,
      type: typeRaw === "file" || typeRaw === "directory" ? typeRaw : "auto",
      overwrite: obj.overwrite === true,
      createDirs: obj.createDirs !== false
    });
  }
  return out;
}
function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
async function runTransfer(item, verify, envMgr, transport, context, index) {
  const from = await createEndpoint(item.fromEnvironment, envMgr, transport);
  const to = await createEndpoint(item.toEnvironment, envMgr, transport);
  from.assertAbsolute(item.fromPath);
  to.assertAbsolute(item.toPath);
  const sourcePath = from.normalize(item.fromPath);
  let targetPath = to.normalize(item.toPath);
  const sourceStat = await from.stat(sourcePath);
  const kind = item.type === "auto" ? hasTrailingSlash(item.fromPath) ? "directory" : sourceStat.type : item.type;
  if (kind === "file" && hasTrailingSlash(item.toPath)) {
    targetPath = to.join(targetPath, from.basename(sourcePath));
  }
  if (kind === "file") {
    const tracker2 = createTransferTracker(context, { files: 1, dirs: 0, bytes: sourceStat.size });
    reportTransferProgress(tracker2);
    const copied2 = await copyFile({ from, to, sourcePath, targetPath, overwrite: item.overwrite, createDirs: item.createDirs, verify, tracker: tracker2 });
    reportTransferProgress(tracker2, true);
    return {
      success: true,
      index,
      type: "file",
      from: { environment: item.fromEnvironment, path: item.fromPath },
      to: { environment: item.toEnvironment, path: item.toPath },
      files: 1,
      dirs: 0,
      bytes: copied2.bytes,
      verify: { mode: verify, ok: copied2.verifyOk }
    };
  }
  const planned = await collectTransferStats(from, sourcePath, sourceStat);
  const tracker = createTransferTracker(context, planned);
  reportTransferProgress(tracker);
  const copied = await copyDirectory({ from, to, sourceDir: sourcePath, targetDir: targetPath, overwrite: item.overwrite, createDirs: item.createDirs, verify, tracker });
  reportTransferProgress(tracker, true);
  return {
    success: true,
    index,
    type: "directory",
    from: { environment: item.fromEnvironment, path: item.fromPath },
    to: { environment: item.toEnvironment, path: item.toPath },
    files: copied.files,
    dirs: copied.dirs,
    bytes: copied.bytes,
    verify: { mode: verify, ok: copied.verifyOk }
  };
}
async function createEndpoint(environment, envMgr, transport) {
  if (environment === LOCAL_ENV)
    return new LocalEndpoint;
  const env = envMgr.listEnvs().find((e) => e.name === environment && !e.isLocal);
  if (!env)
    throw new Error(`未知传输环境: ${environment}`);
  const mode = transport.getTransportMode(environment);
  if (mode === "bash")
    return new RemoteBashEndpoint(environment, transport);
  try {
    const sftp = await transport.getSftp(environment);
    return new RemoteSftpEndpoint(environment, sftp);
  } catch (err) {
    if (mode === "sftp")
      throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("SFTP 子系统不可用"))
      return new RemoteBashEndpoint(environment, transport);
    throw err;
  }
}
function createTransferTracker(context, stats) {
  return {
    context,
    startedAt: Date.now(),
    totalBytes: stats.bytes,
    totalFiles: stats.files,
    transferredBytes: 0,
    completedFiles: 0
  };
}
async function collectTransferStats(endpoint, p, knownStat) {
  const st = knownStat ?? await endpoint.stat(p);
  if (st.type === "file")
    return { files: 1, dirs: 0, bytes: st.size };
  let files = 0;
  let dirs = 1;
  let bytes = 0;
  const entries = await endpoint.readdir(p);
  for (const entry of entries) {
    const child = endpoint.join(p, entry.name);
    if (entry.type === "directory") {
      const nested = await collectTransferStats(endpoint, child);
      files += nested.files;
      dirs += nested.dirs;
      bytes += nested.bytes;
    } else {
      const childStat = await endpoint.stat(child);
      files += 1;
      bytes += childStat.size;
    }
  }
  return { files, dirs, bytes };
}
function reportTransferProgress(tracker, final = false) {
  const elapsedMs = Math.max(1, Date.now() - tracker.startedAt);
  const speedBytesPerSec = tracker.transferredBytes / (elapsedMs / 1000);
  const remainingBytes = Math.max(0, tracker.totalBytes - tracker.transferredBytes);
  const percent = tracker.totalBytes > 0 ? Math.min(100, Math.round(tracker.transferredBytes / tracker.totalBytes * 100)) : 100;
  tracker.context?.reportProgress?.({
    kind: "transfer_files",
    sourcePath: tracker.currentSourcePath,
    targetPath: tracker.currentTargetPath,
    bytesTransferred: tracker.transferredBytes,
    totalBytes: tracker.totalBytes,
    percent: final ? 100 : percent,
    speedBytesPerSec,
    etaSec: speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : undefined,
    elapsedMs,
    filesTransferred: tracker.completedFiles,
    totalFiles: tracker.totalFiles
  });
}
async function copyDirectory(input) {
  const { from, to, sourceDir, targetDir, overwrite, createDirs, verify, tracker } = input;
  const st = await from.stat(sourceDir);
  if (st.type !== "directory")
    throw new Error(`源路径不是目录: ${sourceDir}`);
  if (createDirs)
    await to.mkdirp(targetDir);
  let files = 0;
  let dirs = 1;
  let bytes = 0;
  let verifyOk = true;
  const entries = await from.readdir(sourceDir);
  for (const entry of entries) {
    const src = from.join(sourceDir, entry.name);
    const dst = to.join(targetDir, entry.name);
    if (entry.type === "directory") {
      const nested = await copyDirectory({ from, to, sourceDir: src, targetDir: dst, overwrite, createDirs, verify, tracker });
      files += nested.files;
      dirs += nested.dirs;
      bytes += nested.bytes;
      verifyOk = verifyOk && nested.verifyOk;
    } else {
      const one = await copyFile({ from, to, sourcePath: src, targetPath: dst, overwrite, createDirs, verify, tracker });
      files += 1;
      bytes += one.bytes;
      verifyOk = verifyOk && one.verifyOk;
    }
  }
  return { files, dirs, bytes, verifyOk };
}
async function copyFile(input) {
  const { from, to, sourcePath, targetPath, overwrite, createDirs, verify, tracker } = input;
  const st = await from.stat(sourcePath);
  if (st.type !== "file")
    throw new Error(`源路径不是文件: ${sourcePath}`);
  if (!overwrite && await to.exists(targetPath)) {
    throw new Error(`目标已存在: ${targetPath}`);
  }
  if (createDirs)
    await to.mkdirp(to.dirname(targetPath));
  const tempPath = makeTempPath(to, targetPath);
  tracker.currentSourcePath = sourcePath;
  tracker.currentTargetPath = targetPath;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      const n = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      tracker.transferredBytes += n;
      reportTransferProgress(tracker);
      callback(null, chunk);
    }
  });
  const reader = await from.openRead(sourcePath);
  const writer = await to.openWrite(tempPath, false);
  try {
    await pipeline(reader.stream, progress, writer.stream);
    if (reader.done)
      await reader.done();
    if (writer.done)
      await writer.done();
    let verifyOk = true;
    if (verify === "size") {
      const tempStat = await to.stat(tempPath);
      verifyOk = tempStat.type === "file" && tempStat.size === st.size;
      if (!verifyOk)
        throw new Error(`size 校验失败: source=${st.size}, temp=${tempStat.size}`);
    }
    await to.rename(tempPath, targetPath, overwrite);
    tracker.completedFiles += 1;
    reportTransferProgress(tracker);
    return { bytes: st.size, verifyOk };
  } catch (err) {
    await safeUnlink(to, tempPath);
    throw err;
  }
}
function makeTempPath(endpoint, targetPath) {
  const dir = endpoint.dirname(targetPath);
  const base = endpoint.basename(targetPath) || "target";
  const suffix = `${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}`;
  return endpoint.join(dir, `.${base}.remote-exec-tmp-${suffix}`);
}
async function safeUnlink(endpoint, p) {
  try {
    await endpoint.unlink(p);
  } catch {}
}
function hasTrailingSlash(p) {
  return /[\\/]$/.test(p);
}
function trimTrailingSeparators(p, isRemote) {
  const root = isRemote ? "/" : path.parse(p).root;
  let out = p;
  while (out.length > root.length && /[\\/]$/.test(out))
    out = out.slice(0, -1);
  return out;
}

class LocalEndpoint {
  environment = LOCAL_ENV;
  isLocal = true;
  assertAbsolute(p) {
    if (!path.isAbsolute(p) && !path.win32.isAbsolute(p) && !path.posix.isAbsolute(p)) {
      throw new Error(`本地路径必须是全路径/绝对路径: ${p}`);
    }
  }
  normalize(p) {
    return path.normalize(trimTrailingSeparators(p, false));
  }
  dirname(p) {
    return path.dirname(p);
  }
  basename(p) {
    return path.basename(p);
  }
  join(dir, child) {
    return path.join(dir, child);
  }
  async stat(p) {
    const st = await fsp.stat(p);
    if (st.isDirectory())
      return { type: "directory", size: 0 };
    if (st.isFile())
      return { type: "file", size: st.size };
    throw new Error(`不支持的本地路径类型: ${p}`);
  }
  async exists(p) {
    try {
      await fsp.stat(p);
      return true;
    } catch {
      return false;
    }
  }
  async mkdirp(p) {
    await fsp.mkdir(p, { recursive: true });
  }
  async readdir(p) {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isFile() || e.isDirectory()).map((e) => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" }));
  }
  async unlink(p) {
    await fsp.rm(p, { force: true });
  }
  async rename(src, dst, overwrite) {
    try {
      await fsp.rename(src, dst);
    } catch (err) {
      if (!overwrite)
        throw err;
      await fsp.rm(dst, { force: true });
      await fsp.rename(src, dst);
    }
  }
  async openRead(p) {
    return { stream: fs2.createReadStream(p) };
  }
  async openWrite(p, overwrite) {
    return { stream: fs2.createWriteStream(p, { flags: overwrite ? "w" : "wx" }) };
  }
}

class RemoteSftpEndpoint {
  environment;
  sftp;
  isLocal = false;
  constructor(environment, sftp) {
    this.environment = environment;
    this.sftp = sftp;
  }
  assertAbsolute(p) {
    if (!p.startsWith("/"))
      throw new Error(`远端路径必须是 / 开头的绝对路径: ${p}`);
  }
  normalize(p) {
    return path.posix.normalize(trimTrailingSeparators(p.replace(/\\/g, "/"), true));
  }
  dirname(p) {
    return path.posix.dirname(p);
  }
  basename(p) {
    return path.posix.basename(p);
  }
  join(dir, child) {
    return path.posix.join(dir, child);
  }
  async stat(p) {
    const st = await new Promise((resolve, reject) => this.sftp.stat(p, (err, stats) => err ? reject(err) : resolve(stats)));
    if (st.isDirectory())
      return { type: "directory", size: 0 };
    if (st.isFile())
      return { type: "file", size: st.size };
    throw new Error(`不支持的远端路径类型: ${p}`);
  }
  async exists(p) {
    try {
      await this.stat(p);
      return true;
    } catch {
      return false;
    }
  }
  async mkdirp(p) {
    const normalized = this.normalize(p);
    if (!normalized || normalized === "/")
      return;
    const parts = normalized.split("/").filter(Boolean);
    let cur = "/";
    for (const part of parts) {
      cur = cur === "/" ? `/${part}` : path.posix.join(cur, part);
      try {
        const st = await this.stat(cur);
        if (st.type !== "directory")
          throw new Error(`${cur} 已存在但不是目录`);
      } catch {
        await new Promise((resolve, reject) => this.sftp.mkdir(cur, (err) => err ? reject(err) : resolve()));
      }
    }
  }
  async readdir(p) {
    const list = await new Promise((resolve, reject) => this.sftp.readdir(p, (err, entries) => err ? reject(err) : resolve(entries)));
    return list.filter((e) => e.attrs?.isFile?.() || e.attrs?.isDirectory?.()).map((e) => ({ name: e.filename, type: e.attrs.isDirectory() ? "directory" : "file" }));
  }
  async unlink(p) {
    await new Promise((resolve, reject) => this.sftp.unlink(p, (err) => err ? reject(err) : resolve()));
  }
  async rename(src, dst, overwrite) {
    try {
      await new Promise((resolve, reject) => this.sftp.rename(src, dst, (err) => err ? reject(err) : resolve()));
    } catch (err) {
      if (!overwrite)
        throw err;
      try {
        await this.unlink(dst);
      } catch {}
      await new Promise((resolve, reject) => this.sftp.rename(src, dst, (err2) => err2 ? reject(err2) : resolve()));
    }
  }
  async openRead(p) {
    return { stream: this.sftp.createReadStream(p) };
  }
  async openWrite(p, overwrite) {
    return { stream: this.sftp.createWriteStream(p, { flags: overwrite ? "w" : "wx" }) };
  }
}
function decodeNulListFromBase64(stdout) {
  return Buffer.from(stdout.replace(/\s+/g, ""), "base64").toString("utf8").split("\x00").filter(Boolean);
}
function assertExecOk(result, op) {
  if ((result.exitCode ?? 0) !== 0 || result.timedOut) {
    throw new Error(`${op} 失败: exitCode=${result.exitCode} stderr=${result.stderr}`);
  }
}

class RemoteBashEndpoint {
  environment;
  transport;
  isLocal = false;
  constructor(environment, transport) {
    this.environment = environment;
    this.transport = transport;
  }
  assertAbsolute(p) {
    if (!p.startsWith("/"))
      throw new Error(`远端路径必须是 / 开头的绝对路径: ${p}`);
  }
  normalize(p) {
    return path.posix.normalize(trimTrailingSeparators(p.replace(/\\/g, "/"), true));
  }
  dirname(p) {
    return path.posix.dirname(p);
  }
  basename(p) {
    return path.posix.basename(p);
  }
  join(dir, child) {
    return path.posix.join(dir, child);
  }
  async run(script) {
    return this.transport.execCommand(this.environment, `bash -lc ${shQuote(script)}`);
  }
  async stat(p) {
    const script = `if [ -d ${shQuote(p)} ]; then printf 'directory\\t0'; elif [ -f ${shQuote(p)} ]; then printf 'file\\t%s' "$(wc -c < ${shQuote(p)})"; else echo 'path not found' >&2; exit 44; fi`;
    const result = await this.run(script);
    assertExecOk(result, `stat ${p}`);
    const [type, size] = result.stdout.trim().split("\t");
    if (type === "directory")
      return { type: "directory", size: 0 };
    if (type === "file")
      return { type: "file", size: Number.parseInt(size, 10) || 0 };
    throw new Error(`无法识别远端路径类型: ${p}`);
  }
  async exists(p) {
    const result = await this.run(`[ -e ${shQuote(p)} ]`);
    return (result.exitCode ?? 1) === 0;
  }
  async mkdirp(p) {
    const result = await this.run(`mkdir -p -- ${shQuote(p)}`);
    assertExecOk(result, `mkdir -p ${p}`);
  }
  async readdir(p) {
    const script = `cd -- ${shQuote(p)} && find . -mindepth 1 -maxdepth 1 \\( -type d -print0 -o -type f -print0 \\) 2>/dev/null | while IFS= read -r -d '' x; do rel="\${x#./}"; if [ -d "$x" ]; then printf 'd\\t%s\\0' "$rel"; elif [ -f "$x" ]; then printf 'f\\t%s\\0' "$rel"; fi; done | base64 | tr -d '\\n\\r'`;
    const result = await this.run(script);
    assertExecOk(result, `readdir ${p}`);
    return decodeNulListFromBase64(result.stdout).map((rec) => {
      const tab = rec.indexOf("\t");
      if (tab < 0)
        return;
      const t = rec.slice(0, tab);
      const name = rec.slice(tab + 1);
      if (!name)
        return;
      return { name, type: t === "d" ? "directory" : "file" };
    }).filter((x) => !!x);
  }
  async unlink(p) {
    const result = await this.run(`rm -f -- ${shQuote(p)}`);
    assertExecOk(result, `rm -f ${p}`);
  }
  async rename(src, dst, overwrite) {
    const script = overwrite ? `mv -f -- ${shQuote(src)} ${shQuote(dst)}` : `if [ -e ${shQuote(dst)} ]; then echo 'target exists' >&2; exit 17; fi; mv -- ${shQuote(src)} ${shQuote(dst)}`;
    const result = await this.run(script);
    assertExecOk(result, `rename ${src} -> ${dst}`);
  }
  async openRead(p) {
    const handle = await this.transport.execStream(this.environment, `cat -- ${shQuote(p)}`);
    return {
      stream: handle.stdout,
      done: async () => assertExecOk(await handle.done, `cat ${p}`)
    };
  }
  async openWrite(p, _overwrite) {
    const handle = await this.transport.execStream(this.environment, `cat > ${shQuote(p)}`);
    return {
      stream: handle.stdin,
      done: async () => assertExecOk(await handle.done, `write ${p}`)
    };
  }
}

// src/console-display.ts
var CONSOLE_TOOL_DISPLAY_SERVICE_ID = "console:tool-display";
var CONSOLE_SLASH_COMMAND_SERVICE_ID = "console:slash-command";
var displayRegistration;
var displayRegistering = false;
var slashRegistrations = [];
var slashRegistering = false;
function registerRemoteExecConsoleIntegration(api, envMgr) {
  registerTransferFilesDisplay(api);
  registerEnvironmentSlashCommands(api, envMgr);
}
function disposeRemoteExecConsoleIntegration() {
  displayRegistration?.dispose();
  displayRegistration = undefined;
  displayRegistering = false;
  for (const registration of slashRegistrations.splice(0)) {
    try {
      registration.dispose();
    } catch {}
  }
  slashRegistering = false;
}
function registerTransferFilesDisplay(api) {
  if (displayRegistration || displayRegistering)
    return;
  displayRegistering = true;
  api.services.waitFor(CONSOLE_TOOL_DISPLAY_SERVICE_ID, 5000).then((service) => {
    if (displayRegistration)
      return;
    displayRegistration = service.register("transfer_files", {
      getArgsSummary({ args }) {
        return formatArgsSummary(args);
      },
      getProgressLine({ progress }) {
        return formatProgress(progress);
      },
      getResultSummary({ result }) {
        return formatResult(result);
      }
    });
  }).catch(() => {}).finally(() => {
    displayRegistering = false;
  });
}
function registerEnvironmentSlashCommands(api, envMgr) {
  if (slashRegistrations.length > 0 || slashRegistering)
    return;
  slashRegistering = true;
  api.services.waitFor(CONSOLE_SLASH_COMMAND_SERVICE_ID, 5000).then((service) => {
    if (slashRegistrations.length > 0)
      return;
    const switchTo = async (name) => {
      const sid = api.agentManager?.getActiveSessionId?.();
      if (sid) {
        const { previous, current } = await envMgr.setActive(name);
        return {
          message: previous === current ? `当前已经在环境：${current}` : `已切换环境：${previous} → ${current}`,
          label: "env"
        };
      }
      const store = api.globalStore.agent(api.agentName ?? "__global__").namespace("remote-exec");
      const prev = store.get("activeEnvironment") ?? "local";
      store.set("activeEnvironment", name);
      const msg = prev === name ? `已将默认环境设为：${name}（新对话生效）` : `已将默认环境从 ${prev} 改为：${name}（新对话生效）`;
      return { message: msg, label: "env" };
    };
    slashRegistrations.push(service.register({
      name: "/env",
      description: "查看或快速切换 remote-exec 执行环境",
      acceptsArgs: true,
      getArgSuggestions({ arg }) {
        const q = arg.trim().toLowerCase();
        return envMgr.listEnvs().filter((env) => !q || env.name.toLowerCase().includes(q)).map((env) => ({
          value: env.name,
          description: env.isLocal ? "本地执行环境" : [env.description, env.hostName ? `${env.user ?? "?"}@${env.hostName}` : undefined].filter(Boolean).join(" · ")
        }));
      },
      async handle({ arg }) {
        const name = arg.trim();
        if (name)
          return switchTo(name);
        const current = envMgr.getActive();
        const lines = [
          `当前环境：${current}`,
          "可用环境：",
          ...envMgr.listEnvs().map((env) => `  - ${env.name}${env.isLocal ? " (local)" : env.hostName ? ` (${env.user ?? "?"}@${env.hostName})` : ""}`),
          "",
          "用法：/env <环境名>"
        ];
        return { message: lines.join(`
`), label: "env" };
      }
    }));
  }).catch(() => {}).finally(() => {
    slashRegistering = false;
  });
}
function formatArgsSummary(args) {
  const first = Array.isArray(args.transfers) && args.transfers.length > 0 ? args.transfers[0] : args;
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return Array.isArray(args.transfers) ? `${args.transfers.length} transfers` : "";
  }
  const obj = first;
  const from = `${String(obj.fromEnvironment || "")}:${String(obj.fromPath || "")}`;
  const to = `${String(obj.toEnvironment || "")}:${String(obj.toPath || "")}`;
  const summary = `${from} → ${to}`;
  const clipped = summary.length > 60 ? `${summary.slice(0, 60)}…` : summary;
  return Array.isArray(args.transfers) && args.transfers.length > 1 ? `${clipped} +${args.transfers.length - 1}` : clipped;
}
function formatProgress(progress) {
  if (progress?.kind !== "transfer_files")
    return;
  const transferred = numberField2(progress.bytesTransferred);
  const total = numberField2(progress.totalBytes);
  const percent = numberField2(progress.percent) ?? (transferred != null && total != null && total > 0 ? Math.round(transferred / total * 100) : undefined);
  const speed = numberField2(progress.speedBytesPerSec);
  const eta = numberField2(progress.etaSec);
  const filesDone = numberField2(progress.filesTransferred);
  const filesTotal = numberField2(progress.totalFiles);
  const chunks = [];
  if (percent != null)
    chunks.push(`${Math.max(0, Math.min(100, Math.round(percent)))}%`);
  if (transferred != null && total != null)
    chunks.push(`${formatBytes(transferred)}/${formatBytes(total)}`);
  else if (transferred != null)
    chunks.push(formatBytes(transferred));
  if (filesDone != null && filesTotal != null && filesTotal > 1)
    chunks.push(`${Math.round(filesDone)}/${Math.round(filesTotal)} files`);
  if (speed != null && speed > 0)
    chunks.push(`${formatBytes(speed)}/s`);
  if (eta != null && eta > 0)
    chunks.push(`ETA ${formatDuration(eta)}`);
  return chunks.join(" ") || undefined;
}
function formatResult(result) {
  if (!result || typeof result !== "object")
    return;
  const obj = result;
  const total = numberField2(obj.totalCount);
  const ok = numberField2(obj.successCount);
  const results = Array.isArray(obj.results) ? obj.results : [];
  let bytes = 0;
  for (const item of results) {
    if (item && typeof item === "object") {
      const b = numberField2(item.bytes);
      if (b != null)
        bytes += b;
    }
  }
  const chunks = [];
  if (ok != null && total != null)
    chunks.push(`${Math.round(ok)}/${Math.round(total)}`);
  if (bytes > 0)
    chunks.push(formatBytes(bytes));
  return chunks.join(" ") || undefined;
}
function numberField2(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0)
    return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${units[i]}`;
}
function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0)
    return "";
  if (sec < 60)
    return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

// src/translators.ts
import path3 from "node:path";

// node_modules/irises-extension-sdk/src/tool-utils.ts
import * as path2 from "node:path";
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, `
`).replace(/\r/g, `
`);
}
function sanitizeUnifiedDiffPatch(patch) {
  const normalized = normalizeLineEndings(patch);
  const lines = normalized.split(`
`);
  const out = [];
  for (const line of lines) {
    if (line.startsWith("```"))
      continue;
    if (line.startsWith("***")) {
      if (line === "***" || line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch") || line.startsWith("*** Update File:") || line.startsWith("*** Add File:") || line.startsWith("*** Delete File:") || line.startsWith("*** End of File")) {
        continue;
      }
    }
    out.push(line);
  }
  return out.join(`
`);
}
function splitLinesPreserveTrailing(text) {
  const normalized = normalizeLineEndings(text);
  const endsWithNewline = normalized.endsWith(`
`);
  const lines = normalized.split(`
`);
  if (endsWithNewline)
    lines.pop();
  return { lines, endsWithNewline };
}
function joinLinesPreserveTrailing(lines, endsWithNewline) {
  const body = lines.join(`
`);
  return endsWithNewline ? body + `
` : body;
}
function computeHunkNewLen(hunk) {
  return hunk.lines.reduce((acc, l) => acc + (l.type === "del" ? 0 : 1), 0);
}
function parseUnifiedDiff(patch) {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split(`
`);
  let oldFile;
  let newFile;
  const hunks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      if (hunks.length > 0 || oldFile || newFile) {
        throw new Error("Multi-file patch is not supported. Please split into one apply_diff call per file.");
      }
      i++;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (oldFile && (hunks.length > 0 || newFile)) {
        throw new Error("Multi-file patch is not supported.");
      }
      oldFile = line.slice(4).trim().split("\t")[0]?.trim() || "";
      i++;
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (newFile && hunks.length > 0) {
        throw new Error("Multi-file patch is not supported.");
      }
      newFile = line.slice(4).trim().split("\t")[0]?.trim() || "";
      i++;
      continue;
    }
    if (line.startsWith("@@")) {
      const header = line;
      const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m) {
        throw new Error(`Invalid hunk header: ${header}. ` + `Expected format: @@ -oldStart,oldCount +newStart,newCount @@`);
      }
      const oldStart = parseInt(m[1], 10);
      const oldCount = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10);
      const newCount = m[4] ? parseInt(m[4], 10) : 1;
      const hunkLines = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith("@@") || l.startsWith("--- ") || l.startsWith("diff --git ") || l.startsWith("+++ "))
          break;
        if (l === "") {
          i++;
          continue;
        }
        if (l.startsWith("\\")) {
          i++;
          continue;
        }
        const prefix = l[0];
        const content = l.length > 0 ? l.slice(1) : "";
        if (prefix === " ") {
          hunkLines.push({ type: "context", content, raw: l });
        } else if (prefix === "+") {
          hunkLines.push({ type: "add", content, raw: l });
        } else if (prefix === "-") {
          hunkLines.push({ type: "del", content, raw: l });
        } else {
          throw new Error(`Invalid hunk line prefix '${prefix}' in line: ${l}`);
        }
        i++;
      }
      hunks.push({ oldStart, oldLines: oldCount, newStart, newLines: newCount, header, lines: hunkLines });
      continue;
    }
    i++;
  }
  if (hunks.length === 0) {
    throw new Error("No hunks (@@ ... @@) found in patch.");
  }
  return { oldFile, newFile, hunks };
}
function applyUnifiedDiffBestEffort(originalContent, parsed) {
  const { lines, endsWithNewline } = splitLinesPreserveTrailing(originalContent);
  let delta = 0;
  const appliedHunks = [];
  const results = [];
  for (let hunkIndex = 0;hunkIndex < parsed.hunks.length; hunkIndex++) {
    const hunk = parsed.hunks[hunkIndex];
    const tryApplyAt = (startIndex) => {
      if (startIndex < 0 || startIndex > lines.length) {
        throw new Error(`Hunk start is out of range. ${hunk.header}`);
      }
      let idx = startIndex;
      let removed = 0;
      let added = 0;
      for (const line of hunk.lines) {
        if (line.type === "context") {
          if (lines[idx] !== line.content) {
            throw new Error(`Context mismatch at ${hunk.header}`);
          }
          idx++;
          continue;
        }
        if (line.type === "del") {
          if (lines[idx] !== line.content) {
            throw new Error(`Delete mismatch at ${hunk.header}`);
          }
          lines.splice(idx, 1);
          removed++;
          continue;
        }
        lines.splice(idx, 0, line.content);
        idx++;
        added++;
      }
      return { added, removed };
    };
    const searchHunkInFile = () => {
      const oldLines = hunk.lines.filter((l) => l.type === "context" || l.type === "del").map((l) => l.content);
      if (oldLines.length === 0)
        return [];
      const matches = [];
      const scanLimit = lines.length - oldLines.length + 1;
      for (let s = 0;s < scanLimit; s++) {
        let match = true;
        for (let j = 0;j < oldLines.length; j++) {
          if (lines[s + j] !== oldLines[j]) {
            match = false;
            break;
          }
        }
        if (match)
          matches.push(s);
      }
      return matches;
    };
    let snapshot = lines.slice();
    let applied = false;
    try {
      if (hunk.oldStart >= 0) {
        const baseOldStart = Math.max(1, hunk.oldStart);
        const startIndex = baseOldStart - 1 + delta;
        const { added, removed } = tryApplyAt(startIndex);
        const newLen = computeHunkNewLen(hunk);
        const startLine = startIndex + 1;
        const endLine = startLine + Math.max(newLen, 1) - 1;
        appliedHunks.push({ index: hunkIndex, startLine, endLine });
        delta += added - removed;
        results.push({ index: hunkIndex, ok: true, startLine, endLine });
        applied = true;
      }
    } catch {
      lines.splice(0, lines.length, ...snapshot);
    }
    if (!applied) {
      snapshot = lines.slice();
      const matches = searchHunkInFile();
      if (matches.length === 1) {
        try {
          const startIndex = matches[0];
          const { added, removed } = tryApplyAt(startIndex);
          const newLen = computeHunkNewLen(hunk);
          const startLine = startIndex + 1;
          const endLine = startLine + Math.max(newLen, 1) - 1;
          appliedHunks.push({ index: hunkIndex, startLine, endLine });
          delta += added - removed;
          results.push({ index: hunkIndex, ok: true, startLine, endLine });
          applied = true;
        } catch {
          lines.splice(0, lines.length, ...snapshot);
        }
      }
      if (!applied) {
        const oldLines = hunk.lines.filter((l) => l.type === "context" || l.type === "del").map((l) => l.content);
        let errorMsg;
        if (matches.length === 0) {
          errorMsg = `Hunk context mismatch at ${hunk.header}. Line-number match failed and global search found no match for the context/delete block (${oldLines.length} lines).`;
        } else {
          const candidateLineNums = matches.map((m) => m + 1);
          errorMsg = `Hunk context mismatch at ${hunk.header}. Line-number match failed and global search found ${matches.length} matches (ambiguous). Candidate lines: ${candidateLineNums.join(", ")}.`;
        }
        results.push({ index: hunkIndex, ok: false, error: errorMsg });
      }
    }
  }
  return {
    newContent: joinLinesPreserveTrailing(lines, endsWithNewline),
    appliedHunks,
    results
  };
}
function convertHunksToSearchReplace(hunks) {
  return hunks.map((h) => {
    const startLineHint = Number.isFinite(h.oldStart) ? Math.max(1, h.oldStart) : undefined;
    const searchLines = [];
    const replaceLines = [];
    for (const l of h.lines) {
      if (l.type === "context") {
        searchLines.push(l.content);
        replaceLines.push(l.content);
      } else if (l.type === "del") {
        searchLines.push(l.content);
      } else {
        replaceLines.push(l.content);
      }
    }
    return {
      search: searchLines.join(`
`),
      replace: replaceLines.join(`
`),
      startLine: startLineHint
    };
  });
}
function parseLoosePatchToSearchReplace(patch) {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split(`
`);
  const blocks = [];
  let inHunk = false;
  let searchLines = [];
  let replaceLines = [];
  const flush = () => {
    if (!inHunk)
      return;
    const search = searchLines.join(`
`);
    const replace = replaceLines.join(`
`);
    if (!search.trim()) {
      throw new Error("Loose @@ hunk has empty search block.");
    }
    blocks.push({ search, replace });
    searchLines = [];
    replaceLines = [];
  };
  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      inHunk = true;
      continue;
    }
    if (!inHunk)
      continue;
    if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      flush();
      inHunk = false;
      continue;
    }
    if (line.startsWith("\\") || line === "")
      continue;
    const prefix = line[0];
    const content = line.length > 0 ? line.slice(1) : "";
    if (prefix === " ") {
      searchLines.push(content);
      replaceLines.push(content);
    } else if (prefix === "-") {
      searchLines.push(content);
    } else if (prefix === "+") {
      replaceLines.push(content);
    } else {
      searchLines.push(line);
      replaceLines.push(line);
    }
  }
  flush();
  if (blocks.length === 0) {
    throw new Error("No hunks (@@) found in patch.");
  }
  return blocks;
}
function applySearchReplaceBestEffort(originalContent, blocks) {
  const norm = normalizeLineEndings;
  let currentContent = norm(originalContent);
  const results = [];
  for (let i = 0;i < blocks.length; i++) {
    const block = blocks[i];
    const search = norm(block.search);
    const replace = norm(block.replace);
    if (!search) {
      results.push({ index: i, success: false, error: "Empty search content" });
      continue;
    }
    if (block.startLine && block.startLine > 0) {
      const lines = currentContent.split(`
`);
      let charOffset = 0;
      for (let j = 0;j < Math.min(block.startLine - 1, lines.length); j++) {
        charOffset += lines[j].length + 1;
      }
      const idx = currentContent.indexOf(search, charOffset);
      if (idx !== -1) {
        currentContent = currentContent.slice(0, idx) + replace + currentContent.slice(idx + search.length);
        results.push({ index: i, success: true, matchCount: 1 });
        continue;
      }
    }
    const matchCount = currentContent.split(search).length - 1;
    if (matchCount === 0) {
      results.push({ index: i, success: false, error: "No exact match found", matchCount: 0 });
    } else if (matchCount > 1) {
      results.push({ index: i, success: false, error: `Multiple matches found (${matchCount})`, matchCount });
    } else {
      currentContent = currentContent.replace(search, replace);
      results.push({ index: i, success: true, matchCount: 1 });
    }
  }
  const appliedCount = results.filter((r) => r.success).length;
  return {
    newContent: currentContent,
    results,
    appliedCount,
    failedCount: results.length - appliedCount
  };
}
var DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".limcode"
]);
var BINARY_DETECT_BYTES = 8 * 1024;
function toPosix(p) {
  return p.split(path2.sep).join("/");
}
function escapeRegex(str2) {
  return str2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function globToRegExp(glob) {
  const g = toPosix(glob.trim());
  let re = "^";
  for (let i = 0;i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      const next = g[i + 1];
      if (next === "*") {
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:.*\\/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      continue;
    }
    if ("\\.^$+()[]{}|".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re);
}
function isLikelyBinary(buf) {
  const n = Math.min(buf.length, BINARY_DETECT_BYTES);
  if (n === 0)
    return false;
  let suspicious = 0;
  for (let i = 0;i < n; i++) {
    const b = buf[i];
    if (b === 0)
      return true;
    const isAllowedWhitespace = b === 9 || b === 10 || b === 13;
    const isControl = b < 32 && !isAllowedWhitespace || b === 127;
    if (isControl)
      suspicious++;
  }
  const ratio = suspicious / n;
  return ratio > 0.3;
}
function swapByteOrder16(buf) {
  const len = buf.length - buf.length % 2;
  const out = Buffer.allocUnsafe(len);
  for (let i = 0;i < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}
function decodeText(buf) {
  const hasCRLF = buf.includes(Buffer.from(`\r
`));
  if (buf.length >= 3 && buf[0] === 239 && buf[1] === 187 && buf[2] === 191) {
    return {
      text: buf.subarray(3).toString("utf8"),
      encoding: "utf-8",
      hasBom: true,
      hasCRLF
    };
  }
  if (buf.length >= 2 && buf[0] === 255 && buf[1] === 254) {
    return {
      text: buf.subarray(2).toString("utf16le"),
      encoding: "utf-16le",
      hasBom: true,
      hasCRLF
    };
  }
  if (buf.length >= 2 && buf[0] === 254 && buf[1] === 255) {
    const swapped = swapByteOrder16(buf.subarray(2));
    return {
      text: swapped.toString("utf16le"),
      encoding: "utf-16be",
      hasBom: true,
      hasCRLF
    };
  }
  return {
    text: buf.toString("utf8"),
    encoding: "utf-8",
    hasBom: false,
    hasCRLF
  };
}
function buildSearchRegex(query, isRegex) {
  if (!query || !query.trim()) {
    throw new Error("query 不能为空");
  }
  return isRegex ? new RegExp(query, "g") : new RegExp(escapeRegex(query), "g");
}
function normalizeObjectArrayArg(args, options) {
  const arrayValue = args[options.arrayKey];
  if (Array.isArray(arrayValue) && arrayValue.length > 0) {
    const normalized = arrayValue.filter(options.isEntry);
    return normalized.length === arrayValue.length ? normalized : undefined;
  }
  if (options.isEntry(arrayValue)) {
    return [arrayValue];
  }
  for (const key of options.singularKeys ?? []) {
    const singularValue = args[key];
    if (options.isEntry(singularValue)) {
      return [singularValue];
    }
  }
  if (options.isEntry(args)) {
    return [args];
  }
  return;
}
function normalizeStringArrayArg(args, options) {
  const arrayValue = args[options.arrayKey];
  if (Array.isArray(arrayValue) && arrayValue.length > 0) {
    return arrayValue.every((item) => typeof item === "string" && item.trim().length > 0) ? arrayValue : undefined;
  }
  for (const value of [arrayValue, ...(options.singularKeys ?? []).map((key) => args[key])]) {
    if (typeof value === "string" && value.trim().length > 0) {
      return [value];
    }
  }
  return;
}
function isInsertEntry(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string" && typeof value.line === "number" && typeof value.content === "string";
}
function normalizeInsertArgs(args) {
  return normalizeObjectArrayArg(args, {
    arrayKey: "files",
    singularKeys: ["file"],
    isEntry: isInsertEntry
  });
}
function isDeleteCodeEntry(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string" && typeof value.start_line === "number" && typeof value.end_line === "number";
}
function normalizeDeleteCodeArgs(args) {
  return normalizeObjectArrayArg(args, {
    arrayKey: "files",
    singularKeys: ["file"],
    isEntry: isDeleteCodeEntry
  });
}

// src/translators.ts
var LIMITS = {
  read_file: { maxFiles: 10, maxFileSizeBytes: 2 * 1024 * 1024, maxTotalOutputChars: 200000 },
  list_files: { maxEntries: 2000 },
  find_files: { maxResults: 500 },
  search_in_files: {
    maxResults: 100,
    maxFiles: 50,
    contextLines: 2,
    maxFileSizeBytes: 2 * 1024 * 1024,
    maxLineDisplayChars: 500,
    maxMatchDisplayChars: 200
  },
  shell: { defaultTimeout: 30000, maxOutputChars: 50000 }
};
function mode(ctx) {
  return ctx.transport.getTransportMode(ctx.serverAlias);
}
function posixNormalize(p) {
  return path3.posix.normalize(p.replace(/\\/g, "/"));
}
function hasParentTraversal(p) {
  return p.split("/").some((part) => part === "..");
}
function resolveRemotePath(input, cwd) {
  if (!input || input.includes("\x00"))
    throw new Error(`非法路径: ${input}`);
  const normalizedInput = posixNormalize(input);
  const normalizedCwd = cwd ? posixNormalize(cwd) : undefined;
  if (path3.posix.isAbsolute(normalizedInput)) {
    if (!normalizedCwd)
      return normalizedInput;
    const rel = path3.posix.relative(normalizedCwd, normalizedInput);
    if (rel === "" || !rel.startsWith("..") && !path3.posix.isAbsolute(rel))
      return normalizedInput;
    throw new Error(`路径超出远端工作目录: ${input}`);
  }
  if (hasParentTraversal(normalizedInput))
    throw new Error(`路径超出远端工作目录: ${input}`);
  return normalizedCwd ? path3.posix.join(normalizedCwd, normalizedInput) : normalizedInput;
}
function resolveRemoteCwd(inputCwd, baseCwd) {
  if (!inputCwd)
    return baseCwd;
  return resolveRemotePath(inputCwd, baseCwd);
}
function dirnameRemote(p) {
  const d = path3.posix.dirname(p);
  return d || ".";
}
async function execBash(ctx, script, input) {
  const cmd = withCwd(`bash -lc ${shQuote(script)}`, ctx.remoteCwd);
  return await ctx.transport.execCommand(ctx.serverAlias, cmd, ctx.signal, input);
}
function assertExitOk(r, op) {
  if ((r.exitCode ?? 0) !== 0 || r.timedOut) {
    throw new Error(`${op} 失败: exitCode=${r.exitCode} stderr=${truncate(r.stderr, 800)}`);
  }
}
function isSftpUnavailableError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("SFTP 子系统不可用");
}
function decodeBase64Stdout(stdout) {
  const clean = stdout.replace(/\s+/g, "");
  return Buffer.from(clean, "base64");
}
function decodeNulListFromBase642(stdout) {
  const text = decodeBase64Stdout(stdout).toString("utf8");
  return text.split("\x00").filter(Boolean);
}
function truncate(text, max) {
  if (text.length <= max)
    return text;
  const half = Math.floor(max / 2);
  return text.slice(0, half) + `

... (已截断，共 ${text.length} 字符) ...

` + text.slice(-half);
}
function clampPositiveInteger(value, fallback, max = Number.POSITIVE_INFINITY) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return fallback;
  return Math.min(Math.floor(value), max);
}
function asStringArray(args, arrayKey, singularKeys = []) {
  return normalizeStringArrayArg(args, { arrayKey, singularKeys });
}
function isFileReadRequest(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string";
}
var TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".json5",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".sh",
  ".bash",
  ".zsh",
  ".bat",
  ".cmd",
  ".ps1",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".xml",
  ".svg",
  ".csv",
  ".tsv",
  ".log",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".sql",
  ".vue",
  ".svelte",
  ".astro",
  ""
]);
var TEXT_FILENAMES = new Set(["Makefile", "Dockerfile", "Vagrantfile", "Gemfile", "Rakefile", "LICENSE", "CHANGELOG", "README", ".gitignore", ".dockerignore", ".editorconfig", ".prettierrc", ".eslintrc"]);
function isTextFile(filePath) {
  const ext = path3.posix.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext))
    return true;
  const basename = path3.posix.basename(filePath);
  if (basename.startsWith(".env"))
    return true;
  return TEXT_FILENAMES.has(basename);
}
function formatWithLineNumbers(content, startLine) {
  const lines = content.split(`
`);
  const totalLines = startLine + lines.length - 1;
  const width = String(totalLines).length;
  return lines.map((line, i) => `${String(startLine + i).padStart(width)} | ${line}`).join(`
`);
}
function swapByteOrder162(buf) {
  const len = buf.length - buf.length % 2;
  const out = Buffer.allocUnsafe(len);
  for (let i = 0;i < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}
function encodeText(text, encoding, hasBom, preferCRLF) {
  const normalized = preferCRLF ? text.replace(/\r?\n/g, `\r
`) : text;
  if (encoding === "utf-16le") {
    const body2 = Buffer.from(normalized, "utf16le");
    return hasBom ? Buffer.concat([Buffer.from([255, 254]), body2]) : body2;
  }
  if (encoding === "utf-16be") {
    const bodyBE = swapByteOrder162(Buffer.from(normalized, "utf16le"));
    return hasBom ? Buffer.concat([Buffer.from([254, 255]), bodyBE]) : bodyBE;
  }
  const body = Buffer.from(normalized, "utf8");
  return hasBom ? Buffer.concat([Buffer.from([239, 187, 191]), body]) : body;
}
async function readRemoteBuffer(ctx, toolPath) {
  const m = mode(ctx);
  const remotePath = resolveRemotePath(toolPath, ctx.remoteCwd);
  if (m !== "bash") {
    try {
      return await ctx.transport.sftpReadFile(ctx.serverAlias, remotePath);
    } catch (err) {
      if (m === "sftp" || !isSftpUnavailableError(err))
        throw err;
    }
  }
  const r = await execBash(ctx, `set -euo pipefail
base64 < ${shQuote(remotePath)} | tr -d '\\n\\r'`);
  assertExitOk(r, `读取文件 ${toolPath}`);
  return decodeBase64Stdout(r.stdout);
}
async function statRemoteSize(ctx, toolPath) {
  const m = mode(ctx);
  const remotePath = resolveRemotePath(toolPath, ctx.remoteCwd);
  if (m !== "bash") {
    try {
      const st = await ctx.transport.sftpStat(ctx.serverAlias, remotePath);
      return st.size;
    } catch (err) {
      if (m === "sftp" || !isSftpUnavailableError(err))
        throw err;
    }
  }
  const r = await execBash(ctx, `stat -c %s -- ${shQuote(remotePath)} 2>/dev/null || wc -c < ${shQuote(remotePath)}`);
  assertExitOk(r, `stat ${toolPath}`);
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}
async function writeRemoteBuffer(ctx, toolPath, data) {
  const m = mode(ctx);
  const remotePath = resolveRemotePath(toolPath, ctx.remoteCwd);
  const dir = dirnameRemote(remotePath);
  if (m !== "bash") {
    try {
      await ensureDirSftp(ctx, dir);
      await ctx.transport.sftpWriteFile(ctx.serverAlias, remotePath, data);
      return;
    } catch (err) {
      if (m === "sftp" || !isSftpUnavailableError(err))
        throw err;
    }
  }
  const script = `set -euo pipefail
mkdir -p -- ${shQuote(dir)}
tmp="$(mktemp)"
cat > "$tmp"
mv "$tmp" ${shQuote(remotePath)}`;
  const r = await execBash(ctx, script, data);
  assertExitOk(r, `写入文件 ${toolPath}`);
}
async function ensureDirSftp(ctx, remoteDir) {
  const normalized = posixNormalize(remoteDir);
  if (!normalized || normalized === "." || normalized === "/")
    return;
  const absolute = path3.posix.isAbsolute(normalized);
  const parts = normalized.split("/").filter(Boolean);
  let cur = absolute ? "/" : "";
  for (const part of parts) {
    cur = cur === "/" ? `/${part}` : cur ? path3.posix.join(cur, part) : part;
    try {
      const st = await ctx.transport.sftpStat(ctx.serverAlias, cur);
      if (!st.isDirectory())
        throw new Error(`${cur} exists but is not a directory`);
    } catch {
      await ctx.transport.sftpMkdir(ctx.serverAlias, cur);
    }
  }
}
var tShell = async (args, ctx) => {
  const command = args.command ?? args.cmd ?? "";
  if (!command)
    throw new Error("shell: 缺少 command 参数");
  const cwd = resolveRemoteCwd(typeof args.cwd === "string" ? args.cwd : undefined, ctx.remoteCwd);
  const finalCmd = cwd ? `cd ${shQuote(cwd)} && ${command}` : command;
  const result = await ctx.transport.execCommand(ctx.serverAlias, finalCmd, ctx.signal);
  return {
    command,
    stdout: truncate(result.stdout, LIMITS.shell.maxOutputChars),
    stderr: truncate(result.stderr, LIMITS.shell.maxOutputChars),
    exitCode: result.exitCode ?? (result.signal ? -1 : 0),
    killed: result.timedOut === true,
    remote: { target: ctx.serverAlias, signal: result.signal }
  };
};
async function listOneSftp(ctx, dirPath) {
  const remotePath = resolveRemotePath(dirPath, ctx.remoteCwd);
  const list = await ctx.transport.sftpReaddir(ctx.serverAlias, remotePath);
  const entries = [];
  for (const ent of list) {
    if (ent.filename === ".git" || ent.filename === "node_modules")
      continue;
    const isDir = ent.attrs.isDirectory();
    const isFile = ent.attrs.isFile();
    if (!isDir && !isFile)
      continue;
    entries.push({ name: ent.filename + (isDir ? "/" : ""), type: isDir ? "directory" : "file" });
  }
  entries.sort((a, b) => a.type !== b.type ? a.type === "directory" ? -1 : 1 : a.name.localeCompare(b.name));
  return { path: dirPath, entries, fileCount: entries.filter((e) => e.type === "file").length, dirCount: entries.filter((e) => e.type === "directory").length, success: true };
}
async function listOneBash(ctx, dirPath, recursive) {
  const remotePath = resolveRemotePath(dirPath, ctx.remoteCwd);
  const max = LIMITS.list_files.maxEntries;
  const depth = recursive ? "" : "-maxdepth 1";
  const script = `set -euo pipefail
cd -- ${shQuote(remotePath)}
count=0
find . ${depth} -mindepth 1 \\( -name .git -o -name node_modules \\) -prune -o \\( -type d -print0 -o -type f -print0 \\) 2>/dev/null   | while IFS= read -r -d '' p; do
      rel="\${p#./}"
      [ -z "$rel" ] && continue
      if [ -d "$p" ]; then printf 'd\\t%s\\0' "$rel"; elif [ -f "$p" ]; then printf 'f\\t%s\\0' "$rel"; fi
      count=$((count + 1))
      [ "$count" -ge ${max} ] && break
    true; done   | base64 | tr -d '\\n\\r'`;
  const r = await execBash(ctx, script);
  assertExitOk(r, `列目录 ${dirPath}`);
  const records = decodeNulListFromBase642(r.stdout);
  const entries = [];
  for (const rec of records) {
    const tab = rec.indexOf("\t");
    if (tab < 0)
      continue;
    const y = rec.slice(0, tab);
    const name0 = rec.slice(tab + 1);
    if (!name0)
      continue;
    if (y === "d")
      entries.push({ name: name0 + "/", type: "directory" });
    else if (y === "f")
      entries.push({ name: name0, type: "file" });
  }
  entries.sort((a, b) => a.type !== b.type ? a.type === "directory" ? -1 : 1 : a.name.localeCompare(b.name));
  const out = { path: dirPath, entries, fileCount: entries.filter((e) => e.type === "file").length, dirCount: entries.filter((e) => e.type === "directory").length, success: true };
  if (records.length >= max)
    out.error = `条目数达到上限 (${max})，结果已截断`;
  return out;
}
var tListFiles = async (args, ctx) => {
  let pathList = asStringArray(args, "paths", ["path"]);
  if (!pathList || pathList.length === 0)
    pathList = ["."];
  const recursive = args.recursive === true;
  const results = [];
  let totalFiles = 0;
  let totalDirs = 0;
  let truncated = false;
  for (const p of pathList) {
    try {
      let res;
      if (!recursive && mode(ctx) !== "bash") {
        try {
          res = await listOneSftp(ctx, p);
        } catch (err) {
          if (mode(ctx) === "sftp" || !isSftpUnavailableError(err))
            throw err;
          res = await listOneBash(ctx, p, false);
        }
      } else {
        res = await listOneBash(ctx, p, recursive);
      }
      if (res.error)
        truncated = true;
      results.push(res);
      totalFiles += res.fileCount;
      totalDirs += res.dirCount;
    } catch (err) {
      results.push({ path: p, entries: [], fileCount: 0, dirCount: 0, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const output = { results, totalFiles, totalDirs, totalPaths: pathList.length };
  if (truncated)
    output.truncated = true;
  return output;
};
var tReadFile = async (args, ctx) => {
  const fileList = normalizeObjectArrayArg(args, { arrayKey: "files", singularKeys: ["file"], isEntry: isFileReadRequest });
  if (!fileList || fileList.length === 0)
    throw new Error("files 参数必须是非空数组");
  const cappedList = fileList.length > LIMITS.read_file.maxFiles ? fileList.slice(0, LIMITS.read_file.maxFiles) : fileList;
  const filesCapped = fileList.length > LIMITS.read_file.maxFiles;
  const results = [];
  let successCount = 0, failCount = 0, totalOutputChars = 0;
  for (const req of cappedList) {
    try {
      if (!isTextFile(req.path))
        throw new Error(`不支持的文件类型: ${path3.posix.extname(req.path) || "(无扩展名)"}`);
      const size = await statRemoteSize(ctx, req.path);
      if (size !== undefined && size > LIMITS.read_file.maxFileSizeBytes)
        throw new Error(`文件过大 (${size} bytes > ${LIMITS.read_file.maxFileSizeBytes} bytes)，请使用 startLine/endLine 分段读取`);
      const raw = (await readRemoteBuffer(ctx, req.path)).toString("utf8");
      const allLines = raw.split(`
`);
      const totalLines = allLines.length;
      const startLine = Math.max(1, req.startLine ?? 1);
      const endLine = req.endLine ? Math.min(req.endLine, totalLines) : totalLines;
      if (startLine > totalLines)
        throw new Error(`startLine (${startLine}) 超出文件总行数 (${totalLines})`);
      const sliced = allLines.slice(startLine - 1, endLine);
      const formatted = formatWithLineNumbers(sliced.join(`
`), startLine);
      totalOutputChars += formatted.length;
      if (totalOutputChars > LIMITS.read_file.maxTotalOutputChars) {
        results.push({ path: req.path, success: false, error: `总输出已达上限 (${LIMITS.read_file.maxTotalOutputChars} chars)，后续文件已跳过。请使用 startLine/endLine 分段读取` });
        failCount++;
        break;
      }
      const res = { path: req.path, success: true, type: "text", content: formatted, lineCount: sliced.length };
      if (req.startLine !== undefined || req.endLine !== undefined) {
        res.totalLines = totalLines;
        res.startLine = startLine;
        res.endLine = endLine;
      }
      results.push(res);
      successCount++;
    } catch (err) {
      results.push({ path: req.path, success: false, error: err instanceof Error ? err.message : String(err) });
      failCount++;
    }
  }
  const output = { results, successCount, failCount, totalCount: cappedList.length };
  if (filesCapped) {
    output.warning = `文件数量已截断: 请求 ${fileList.length} 个，上限 ${LIMITS.read_file.maxFiles} 个`;
    output.totalCount = fileList.length;
  }
  return output;
};
var tWriteFile = async (args, ctx) => {
  const filePath = args.path;
  const content = args.content;
  if (!filePath)
    throw new Error("path 参数不能为空");
  if (typeof content !== "string")
    throw new Error("content 参数必须为字符串");
  let exists = false;
  let same = false;
  try {
    const old = await readRemoteBuffer(ctx, filePath);
    exists = true;
    same = old.toString("utf8") === content;
  } catch {
    exists = false;
  }
  if (same)
    return { path: filePath, success: true, action: "unchanged" };
  await writeRemoteBuffer(ctx, filePath, content);
  return { path: filePath, success: true, action: exists ? "modified" : "created" };
};
var tCreateDir = async (args, ctx) => {
  const paths = asStringArray(args, "paths", ["path"]);
  if (!paths || paths.length === 0)
    throw new Error("paths 参数必须是非空数组");
  const resolved = paths.map((p) => resolveRemotePath(p, ctx.remoteCwd));
  const argsQuoted = resolved.map(shQuote).join(" ");
  const script = `set +e
for p in ${argsQuoted}; do
  if mkdir -p -- "$p"; then printf '1\\t%s\\0' "$p"; else printf '0\\t%s\\tmkdir failed\\0' "$p"; fi
done | base64 | tr -d '\\n\\r'`;
  const r = await execBash(ctx, script);
  assertExitOk(r, "创建目录");
  const recs = decodeNulListFromBase642(r.stdout);
  const byResolved = new Map;
  for (const rec of recs) {
    const [ok, p, err] = rec.split("\t");
    byResolved.set(p, { success: ok === "1", error: ok === "1" ? undefined : err });
  }
  const results = paths.map((p, i) => ({ path: p, success: byResolved.get(resolved[i])?.success ?? false, error: byResolved.get(resolved[i])?.error }));
  return { results, successCount: results.filter((r2) => r2.success).length, failCount: results.filter((r2) => !r2.success).length, totalCount: paths.length };
};
var tDeleteFile = async (args, ctx) => {
  const paths = asStringArray(args, "paths", ["path"]);
  if (!paths || paths.length === 0)
    throw new Error("paths 参数必须是非空数组");
  const resolved = paths.map((p) => resolveRemotePath(p, ctx.remoteCwd));
  const argsQuoted = resolved.map(shQuote).join(" ");
  const script = `set +e
for p in ${argsQuoted}; do
  if rm -rf -- "$p"; then printf '1\\t%s\\0' "$p"; else printf '0\\t%s\\trm failed\\0' "$p"; fi
done | base64 | tr -d '\\n\\r'`;
  const r = await execBash(ctx, script);
  assertExitOk(r, "删除文件");
  const recs = decodeNulListFromBase642(r.stdout);
  const byResolved = new Map;
  for (const rec of recs) {
    const [ok, p, err] = rec.split("\t");
    byResolved.set(p, { success: ok === "1", error: ok === "1" ? undefined : err });
  }
  const results = paths.map((p, i) => ({ path: p, success: byResolved.get(resolved[i])?.success ?? false, error: byResolved.get(resolved[i])?.error }));
  return { results, successCount: results.filter((r2) => r2.success).length, failCount: results.filter((r2) => !r2.success).length, totalCount: paths.length };
};
var DEFAULT_EXCLUDE = "**/node_modules/**";
var DEFAULT_IGNORED_DIRS2 = [".git", "node_modules", "dist", "build", ".next", ".turbo", ".limcode"];
function parseBraceList(input) {
  const s = input.trim();
  if (s.startsWith("{") && s.endsWith("}"))
    return s.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean);
  return [s];
}
function buildExcludeMatchers(exclude) {
  return parseBraceList(exclude).map((p) => globToRegExp(p));
}
function isExcluded(rel, matchers) {
  return matchers.some((re) => re.test(rel));
}
async function listAllFiles(ctx, inputPath = ".", pattern = "**/*") {
  const remotePath = resolveRemotePath(inputPath, ctx.remoteCwd);
  const prunes = DEFAULT_IGNORED_DIRS2.map((d) => `-name ${shQuote(d)}`).join(" -o ");
  const script = `set -euo pipefail
if [ -f ${shQuote(remotePath)} ]; then
  { printf 'F\\0'; printf '%s\\0' ${shQuote(path3.posix.basename(inputPath))}; } | base64 | tr -d '\\n\\r'
else
  cd -- ${shQuote(remotePath)}
  { printf 'D\\0'; find . \\( ${prunes} \\) -prune -o -type f -print0 2>/dev/null; } | base64 | tr -d '\\n\\r'
fi`;
  const r = await execBash(ctx, script);
  assertExitOk(r, `列出候选文件 ${inputPath}`);
  const decoded = decodeNulListFromBase642(r.stdout);
  const marker = decoded.shift();
  const raw = decoded;
  const patternRe = globToRegExp(pattern);
  const isSingle = marker === "F";
  const out = [];
  for (const rel0 of raw) {
    const rel = rel0.replace(/^\.\//, "");
    if (!isSingle && !patternRe.test(rel))
      continue;
    const display = isSingle ? inputPath : inputPath === "." ? rel : path3.posix.join(inputPath, rel);
    out.push({ rel, display, toolPath: display });
  }
  return out;
}
var tFindFiles = async (args, ctx) => {
  const patterns = args.patterns;
  if (!Array.isArray(patterns) || patterns.length === 0 || patterns.some((p) => typeof p !== "string"))
    throw new Error("patterns 参数必须是非空字符串数组");
  const patternList = patterns.map((p) => String(p).trim()).filter(Boolean);
  if (patternList.length === 0)
    throw new Error("patterns 参数不能为空");
  const exclude = args.exclude ?? DEFAULT_EXCLUDE;
  const maxResults = clampPositiveInteger(args.maxResults, LIMITS.find_files.maxResults, LIMITS.find_files.maxResults);
  const files = await listAllFiles(ctx, ".", "**/*");
  const excludeMatchers = buildExcludeMatchers(exclude);
  const patternRes = patternList.map((p) => ({ pattern: p, re: globToRegExp(p), matches: [], truncated: false }));
  for (const f of files) {
    const rel = f.rel;
    if (isExcluded(rel, excludeMatchers))
      continue;
    for (const p of patternRes) {
      if (p.matches.length >= maxResults)
        continue;
      if (p.re.test(rel)) {
        p.matches.push(rel);
        if (p.matches.length >= maxResults)
          p.truncated = true;
      }
    }
    if (patternRes.every((p) => p.matches.length >= maxResults))
      break;
  }
  for (const p of patternRes)
    p.matches.sort();
  const perPattern = patternRes.map((p) => ({ pattern: p.pattern, matches: p.matches, count: p.matches.length, truncated: p.truncated }));
  const results = Array.from(new Set(perPattern.flatMap((p) => p.matches))).sort();
  return { patterns: patternList, exclude, maxResults, perPattern, results, count: results.length, truncated: perPattern.some((p) => p.truncated) };
};
function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0;i < text.length; i++)
    if (text[i] === `
`)
      starts.push(i + 1);
  return starts;
}
function findLineIndex(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (starts[mid] === offset)
      return mid;
    if (starts[mid] < offset)
      lo = mid + 1;
    else
      hi = mid - 1;
  }
  return Math.max(0, lo - 1);
}
function truncateLine(line, max) {
  if (line.length <= max)
    return line;
  const head = Math.floor(max * 0.75), tail = Math.floor(max * 0.15);
  return line.slice(0, head) + ` ... [${line.length} chars] ... ` + line.slice(-tail);
}
function buildContext(lines, lineNum, ctxLines, maxChars) {
  const start = Math.max(1, lineNum - ctxLines), end = Math.min(lines.length, lineNum + ctxLines);
  const out = [];
  for (let ln = start;ln <= end; ln++)
    out.push(`${ln}: ${truncateLine(lines[ln - 1] ?? "", maxChars)}`);
  return out.join(`
`);
}
function canPrefilterRegexWithGrepE(query) {
  if (!query || query.includes(`
`) || query.includes("\r"))
    return false;
  const unsafe = [
    /\(\?/,
    /\\[dDsSwWbBpPkK]/,
    /\\[nrtfv0xuUc]/,
    /\[\[:/,
    /(\*|\+|\?|\})\?/
  ];
  return !unsafe.some((re) => re.test(query));
}
async function grepCandidateFiles(ctx, inputPath, pattern, query, grepMode) {
  const remotePath = resolveRemotePath(inputPath, ctx.remoteCwd);
  const prunes = DEFAULT_IGNORED_DIRS2.map((d) => `-name ${shQuote(d)}`).join(" -o ");
  const flag = grepMode === "literal" ? "-F" : "-E";
  const preflight = grepMode === "regex-ere" ? `grep -E -e ${shQuote(query)} </dev/null >/dev/null 2>/dev/null; st=$?; [ "$st" -gt 1 ] && exit 2` : "";
  const script = `set +e
${preflight}
if [ -f ${shQuote(remotePath)} ]; then
  { printf 'F\\0'; grep -IlZ ${flag} -e ${shQuote(query)} -- ${shQuote(remotePath)} 2>/dev/null; } | base64 | tr -d '\\n\\r'
else
  cd -- ${shQuote(remotePath)} || exit 0
  { printf 'D\\0'; find . \\( ${prunes} \\) -prune -o -type f -print0 2>/dev/null | xargs -0 grep -IlZ ${flag} -e ${shQuote(query)} -- 2>/dev/null; } | base64 | tr -d '\\n\\r'
fi`;
  const r = await execBash(ctx, script);
  if ((r.exitCode ?? 0) > 1)
    return;
  if (!r.stdout.trim())
    return [];
  const decoded = decodeNulListFromBase642(r.stdout);
  const marker = decoded.shift();
  const rels = decoded;
  const patternRe = globToRegExp(pattern);
  const out = [];
  const singleFile = marker === "F";
  for (const rel0 of rels) {
    const rel = rel0.replace(/^\.\//, "");
    if (!singleFile && !patternRe.test(rel))
      continue;
    const display = singleFile ? inputPath : inputPath === "." ? rel : path3.posix.join(inputPath, rel);
    out.push({ rel, display, toolPath: display });
  }
  return out;
}
var tSearchInFiles = async (args, ctx) => {
  const modeArg = args.mode ?? "search";
  if (modeArg !== "search" && modeArg !== "replace")
    throw new Error(`mode 参数无效: ${String(args.mode)}`);
  const query = String(args.query ?? "");
  const inputPath = args.path ?? ".";
  const pattern = args.pattern ?? "**/*";
  const isRegex = args.isRegex ?? false;
  const maxResults = clampPositiveInteger(args.maxResults, LIMITS.search_in_files.maxResults, LIMITS.search_in_files.maxResults);
  const maxFiles = clampPositiveInteger(args.maxFiles, LIMITS.search_in_files.maxFiles, LIMITS.search_in_files.maxFiles);
  const contextLines = clampPositiveInteger(args.contextLines, LIMITS.search_in_files.contextLines, LIMITS.search_in_files.contextLines);
  const maxFileSizeBytes = clampPositiveInteger(args.maxFileSizeBytes, LIMITS.search_in_files.maxFileSizeBytes, LIMITS.search_in_files.maxFileSizeBytes);
  const regex = buildSearchRegex(query, isRegex);
  let candidates;
  if (!isRegex) {
    candidates = await grepCandidateFiles(ctx, inputPath, pattern, query, "literal") ?? await listAllFiles(ctx, inputPath, pattern);
  } else if (canPrefilterRegexWithGrepE(query)) {
    candidates = await grepCandidateFiles(ctx, inputPath, pattern, query, "regex-ere") ?? await listAllFiles(ctx, inputPath, pattern);
  } else {
    candidates = await listAllFiles(ctx, inputPath, pattern);
  }
  if (modeArg === "search") {
    const results2 = [];
    let filesSearched = 0, skippedBinary = 0, skippedTooLarge = 0, truncated2 = false;
    for (const f of candidates) {
      if (results2.length >= maxResults) {
        truncated2 = true;
        break;
      }
      filesSearched++;
      const buf = await readRemoteBuffer(ctx, f.toolPath);
      if (buf.length > maxFileSizeBytes) {
        skippedTooLarge++;
        continue;
      }
      if (isLikelyBinary(buf)) {
        skippedBinary++;
        continue;
      }
      const textLF = decodeText(buf).text.replace(/\r\n/g, `
`).replace(/\r/g, `
`);
      const localRegex = new RegExp(regex.source, regex.flags);
      const starts = computeLineStarts(textLF);
      const lines = textLF.split(`
`);
      for (;; ) {
        const m = localRegex.exec(textLF);
        if (!m)
          break;
        if (m[0].length === 0) {
          localRegex.lastIndex++;
          continue;
        }
        const offset = m.index ?? 0;
        const lineIndex0 = findLineIndex(starts, offset);
        const lineNum = lineIndex0 + 1;
        const col = offset - (starts[lineIndex0] ?? 0) + 1;
        results2.push({ file: f.display, line: lineNum, column: col, match: truncateLine(m[0], LIMITS.search_in_files.maxMatchDisplayChars), context: buildContext(lines, lineNum, contextLines, LIMITS.search_in_files.maxLineDisplayChars) });
        if (results2.length >= maxResults) {
          truncated2 = true;
          break;
        }
      }
    }
    return { mode: modeArg, query, isRegex, path: inputPath, pattern, results: results2, count: results2.length, truncated: truncated2, filesSearched, skippedBinary, skippedTooLarge };
  }
  const replace = args.replace;
  if (typeof replace !== "string")
    throw new Error("replace 模式下必须提供 replace 参数");
  const results = [];
  let processedFiles = 0, totalReplacements = 0, truncated = false;
  for (const f of candidates) {
    if (processedFiles >= maxFiles) {
      truncated = true;
      break;
    }
    processedFiles++;
    const buf = await readRemoteBuffer(ctx, f.toolPath);
    if (buf.length > maxFileSizeBytes) {
      results.push({ file: f.display, replacements: 0, changed: false, skipped: true, reason: `file too large (> ${maxFileSizeBytes} bytes)` });
      continue;
    }
    if (isLikelyBinary(buf)) {
      results.push({ file: f.display, replacements: 0, changed: false, skipped: true, reason: "binary file" });
      continue;
    }
    const decoded = decodeText(buf);
    const countRegex = new RegExp(regex.source, regex.flags);
    let replacements = 0;
    for (;; ) {
      const m = countRegex.exec(decoded.text);
      if (!m)
        break;
      if (m[0].length === 0) {
        countRegex.lastIndex++;
        continue;
      }
      replacements++;
    }
    if (replacements === 0) {
      results.push({ file: f.display, replacements: 0, changed: false });
      continue;
    }
    const newText = decoded.text.replace(new RegExp(regex.source, regex.flags), replace);
    const changed = newText !== decoded.text;
    if (changed)
      await writeRemoteBuffer(ctx, f.toolPath, encodeText(newText, decoded.encoding, decoded.hasBom, decoded.hasCRLF));
    results.push({ file: f.display, replacements, changed });
    totalReplacements += replacements;
  }
  return { mode: modeArg, query, replace, isRegex, path: inputPath, pattern, results, processedFiles, totalReplacements, truncated };
};
var tInsertCode = async (args, ctx) => {
  const entries = normalizeInsertArgs(args);
  if (!entries || entries.length === 0)
    throw new Error("参数必须包含 path、line、content");
  const results = [];
  for (const e of entries) {
    const content = (await readRemoteBuffer(ctx, e.path)).toString("utf8");
    const lines = content.split(`
`);
    const totalLines = lines.length;
    if (e.line < 1 || e.line > totalLines + 1)
      throw new Error(`行号 ${e.line} 超出范围（1~${totalLines + 1}）`);
    const insertLines = e.content.split(`
`);
    const idx = e.line - 1;
    const newLines = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)];
    await writeRemoteBuffer(ctx, e.path, newLines.join(`
`));
    results.push({ path: e.path, success: true, line: e.line, insertedLines: insertLines.length });
  }
  return results.length === 1 ? results[0] : { results, successCount: results.length, totalCount: results.length };
};
var tDeleteCode = async (args, ctx) => {
  const entries = normalizeDeleteCodeArgs(args);
  if (!entries || entries.length === 0)
    throw new Error("参数必须包含 path、start_line、end_line");
  const results = [];
  for (const e of entries) {
    const content = (await readRemoteBuffer(ctx, e.path)).toString("utf8");
    const lines = content.split(`
`);
    const totalLines = lines.length;
    if (e.start_line < 1 || e.start_line > totalLines)
      throw new Error(`start_line ${e.start_line} 超出范围（1~${totalLines}）`);
    if (e.end_line < e.start_line || e.end_line > totalLines)
      throw new Error(`end_line ${e.end_line} 超出范围（${e.start_line}~${totalLines}）`);
    const newLines = [...lines.slice(0, e.start_line - 1), ...lines.slice(e.end_line)];
    await writeRemoteBuffer(ctx, e.path, newLines.join(`
`));
    results.push({ path: e.path, success: true, start_line: e.start_line, end_line: e.end_line, deletedLines: e.end_line - e.start_line + 1 });
  }
  return results.length === 1 ? results[0] : { results, successCount: results.length, totalCount: results.length };
};
var tApplyDiff = async (args, ctx) => {
  const filePath = args.path;
  const patch = args.patch;
  if (!filePath || typeof patch !== "string")
    throw new Error("apply_diff: path 和 patch 必填");
  const content = (await readRemoteBuffer(ctx, filePath)).toString("utf8");
  let newContent;
  let appliedCount;
  let failedCount;
  let totalHunks;
  let results;
  let fallbackMode = "none";
  try {
    const parsed = parseUnifiedDiff(patch);
    const applied = applyUnifiedDiffBestEffort(content, parsed);
    totalHunks = parsed.hunks.length;
    appliedCount = applied.results.filter((r) => r.ok).length;
    failedCount = totalHunks - appliedCount;
    newContent = applied.newContent;
    results = applied.results.map((r) => ({ index: r.index, success: r.ok, error: r.error }));
    if (appliedCount < totalHunks) {
      const srBlocks = convertHunksToSearchReplace(parsed.hunks);
      const srResult = applySearchReplaceBestEffort(content, srBlocks);
      if (srResult.appliedCount > appliedCount) {
        appliedCount = srResult.appliedCount;
        failedCount = srResult.failedCount;
        newContent = srResult.newContent;
        results = srResult.results.map((r) => ({ index: r.index, success: r.success, error: r.error }));
        fallbackMode = "unified_hunks_search_replace";
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Invalid hunk header")) {
      const looseBlocks = parseLoosePatchToSearchReplace(patch);
      const looseResult = applySearchReplaceBestEffort(content, looseBlocks);
      totalHunks = looseBlocks.length;
      appliedCount = looseResult.appliedCount;
      failedCount = looseResult.failedCount;
      newContent = looseResult.newContent;
      results = looseResult.results.map((r) => ({ index: r.index, success: r.success, error: r.error }));
      fallbackMode = "loose_hunk_search_replace";
    } else
      throw e;
  }
  if (appliedCount === 0)
    throw new Error(`所有 hunk 均失败: ${results.find((r) => !r.success)?.error || "All hunks failed"}`);
  await writeRemoteBuffer(ctx, filePath, newContent);
  return { path: filePath, totalHunks, applied: appliedCount, failed: failedCount, results, fallbackMode };
};
var TRANSLATORS = {
  shell: tShell,
  bash: tShell,
  list_files: tListFiles,
  read_file: tReadFile,
  write_file: tWriteFile,
  create_directory: tCreateDir,
  delete_file: tDeleteFile,
  find_files: tFindFiles,
  search_in_files: tSearchInFiles,
  insert_code: tInsertCode,
  delete_code: tDeleteCode,
  apply_diff: tApplyDiff
};
function getTranslator(toolName) {
  return TRANSLATORS[toolName];
}
function listSupportedTools() {
  return Object.keys(TRANSLATORS);
}

// src/wrap.ts
function installToolWrappers(p) {
  const { api, envMgr, getConfig, getTransport, logger } = p;
  const wrappedTools = new WeakSet;
  const restoreList = [];
  const wrapToolObject = (toolName, tool) => {
    if (!tool || wrappedTools.has(tool))
      return;
    const translator = getTranslator(toolName);
    if (!translator)
      return;
    const original = tool.handler;
    const wrapped = async (args, context) => {
      const cfg = getConfig();
      if (!cfg.enabled)
        return original(args, context);
      const activeName = envMgr.getActive();
      if (activeName === LOCAL_ENV)
        return original(args, context);
      const server = envMgr.getActiveServer();
      if (!server) {
        logger.warn(`active=${activeName} 但找不到对应服务器条目，降级本地执行`);
        return original(args, context);
      }
      const remoteCwd = server.workdir ?? cfg.remoteWorkdir;
      try {
        return await translator(args, {
          transport: getTransport(),
          serverAlias: activeName,
          remoteCwd,
          signal: context?.signal
        });
      } catch (err) {
        const msg = err.message;
        logger.warn(`远程执行 ${toolName} 失败 (${activeName}): ${msg}`);
        throw new Error(`[remote-exec/${activeName}] ${toolName} 远端执行失败: ${msg}`);
      }
    };
    tool.handler = wrapped;
    wrappedTools.add(tool);
    restoreList.push(() => {
      if (tool.handler === wrapped)
        tool.handler = original;
    });
    logger.info(`已为工具安装 remote-exec wrapper: ${toolName}`);
  };
  const applyToExistingTools = () => {
    const supported = new Set(listSupportedTools());
    const names = api.tools.listTools?.() ?? [];
    for (const name of names) {
      if (!supported.has(name))
        continue;
      wrapToolObject(name, api.tools.get?.(name));
    }
  };
  const registry = api.tools;
  const originalRegister = registry.register?.bind(registry);
  let registerPatched = false;
  if (typeof originalRegister === "function") {
    registry.register = function(tool) {
      const ret = originalRegister(tool);
      const name = tool?.declaration?.name;
      if (name && getTranslator(name)) {
        queueMicrotask(() => wrapToolObject(name, api.tools.get?.(name) ?? tool));
      }
      return ret;
    };
    registerPatched = true;
  }
  return {
    applyToExistingTools,
    dispose() {
      if (registerPatched && typeof originalRegister === "function")
        registry.register = originalRegister;
      for (const restore of restoreList.splice(0))
        restore();
    }
  };
}

// src/index.ts
var logger = createPluginLogger("remote-exec");
var cfg = parseRemoteExecConfig({});
var servers = new Map;
var transport;
var envMgr;
var installer;
var cachedApi;
var cachedCtx;
var switchToolRegistered = false;
var transferToolRegistered = false;
var src_default = definePlugin({
  name: "remote-exec",
  version: "0.1.0",
  description: '把工具调用透明转发到远端服务器执行（按"环境"切换，AI 无感）',
  activate(ctx) {
    cachedCtx = ctx;
    if (ctx.ensureConfigFile("remote_exec.yaml", DEFAULT_REMOTE_EXEC_YAML)) {
      logger.info("已生成默认配置 remote_exec.yaml");
    }
    if (ctx.ensureConfigFile("remote_exec_servers.yaml", DEFAULT_REMOTE_EXEC_SERVERS_YAML)) {
      logger.info("已生成默认服务器配置 remote_exec_servers.yaml");
    }
    ctx.onReady(async (api) => {
      cachedApi = api;
      await reloadAll(ctx, api);
    });
    ctx.addHook({
      name: "remote-exec:env-preload",
      priority: 50,
      async onBeforeLLMCall() {
        const sid = cachedApi?.agentManager?.getActiveSessionId?.();
        if (sid && envMgr) {
          await envMgr.ensureLoaded(sid);
        }
        return;
      }
    });
    ctx.addHook({
      name: "remote-exec:config-reload",
      async onConfigReload({ rawMergedConfig }) {
        if (!cachedApi || !cachedCtx)
          return;
        const raw = rawMergedConfig?.remote_exec;
        cfg = parseRemoteExecConfig(raw ?? {});
        servers = readServersSection(cachedCtx, rawMergedConfig);
        rebuildTransport();
        reregisterRemoteExecTools(cachedApi);
        installer?.applyToExistingTools();
        logger.info(`remote-exec 配置已热重载 — enabled=${cfg.enabled} servers=[${[...servers.keys()].join(", ")}] active=${envMgr?.getActive() ?? "n/a"}`);
      }
    });
  },
  async deactivate() {
    installer?.dispose();
    installer = undefined;
    transport?.closeAll();
    transport = undefined;
    if (cachedApi && switchToolRegistered) {
      cachedApi.tools.unregister?.("switch_environment");
      switchToolRegistered = false;
    }
    if (cachedApi && transferToolRegistered) {
      cachedApi.tools.unregister?.(TRANSFER_FILES_TOOL_NAME);
      transferToolRegistered = false;
    }
    disposeRemoteExecConsoleIntegration();
    envMgr = undefined;
    cachedApi = undefined;
    cachedCtx = undefined;
  }
});
function readServersSection(ctx, rawMergedConfig) {
  const raw = rawMergedConfig?.remote_exec_servers ?? ctx.readConfigSection("remote_exec_servers");
  const parsed = parseServersSectionDetailed(raw);
  for (const warning of parsed.warnings) {
    logger.warn(`remote_exec_servers.yaml: ${warning}`);
  }
  if (raw && parsed.servers.size === 0) {
    logger.warn("remote_exec_servers.yaml 中未解析到有效 servers。请检查格式：servers.<name>.hostName / user / password|identityFile");
  }
  return parsed.servers;
}
async function reloadAll(ctx, api) {
  const merged = api.configManager?.readEditableConfig?.();
  const rawSection = merged?.remote_exec ?? ctx.readConfigSection("remote_exec");
  cfg = parseRemoteExecConfig(rawSection ?? {});
  servers = readServersSection(ctx, merged);
  rebuildTransport();
  envMgr = new EnvironmentManager(api, () => servers, () => cfg);
  reregisterRemoteExecTools(api);
  if (!installer) {
    installer = installToolWrappers({
      ctx,
      api,
      envMgr,
      getConfig: () => cfg,
      getTransport: () => {
        if (!transport)
          throw new Error("remote-exec: SSH transport 未就绪");
        return transport;
      },
      logger
    });
  }
  installer.applyToExistingTools();
  logger.info(`remote-exec 就绪 — enabled=${cfg.enabled} servers=[${[...servers.keys()].join(", ")}] ` + `default=${cfg.defaultEnvironment} active=${envMgr.getActive()}`);
}
function rebuildTransport() {
  if (transport)
    transport.closeAll();
  transport = new SshTransport(servers, cfg.ssh, logger);
}
function reregisterRemoteExecTools(api) {
  if (!envMgr)
    return;
  if (switchToolRegistered) {
    api.tools.unregister?.("switch_environment");
    switchToolRegistered = false;
  }
  if (transferToolRegistered) {
    api.tools.unregister?.(TRANSFER_FILES_TOOL_NAME);
    transferToolRegistered = false;
  }
  if (!cfg.enabled)
    return;
  if (cfg.exposeSwitchTool) {
    const tool = buildSwitchEnvironmentTool(envMgr);
    api.tools.register(tool);
    switchToolRegistered = true;
  }
  const transferTool = buildTransferFilesTool(envMgr, () => {
    if (!transport)
      throw new Error("remote-exec: SSH transport 未就绪");
    return transport;
  });
  api.tools.register(transferTool);
  transferToolRegistered = true;
  registerRemoteExecConsoleIntegration(api, envMgr);
}
export {
  src_default as default
};
