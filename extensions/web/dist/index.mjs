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

// ../../node_modules/yaml/dist/nodes/identity.js
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

// ../../node_modules/yaml/dist/visit.js
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

// ../../node_modules/yaml/dist/doc/directives.js
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

// ../../node_modules/yaml/dist/doc/anchors.js
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

// ../../node_modules/yaml/dist/doc/applyReviver.js
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

// ../../node_modules/yaml/dist/nodes/toJS.js
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

// ../../node_modules/yaml/dist/nodes/Node.js
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

// ../../node_modules/yaml/dist/nodes/Alias.js
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

// ../../node_modules/yaml/dist/nodes/Scalar.js
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

// ../../node_modules/yaml/dist/doc/createNode.js
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

// ../../node_modules/yaml/dist/nodes/Collection.js
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

// ../../node_modules/yaml/dist/stringify/stringifyComment.js
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

// ../../node_modules/yaml/dist/stringify/foldFlowLines.js
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

// ../../node_modules/yaml/dist/stringify/stringifyString.js
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

// ../../node_modules/yaml/dist/stringify/stringify.js
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

// ../../node_modules/yaml/dist/stringify/stringifyPair.js
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

// ../../node_modules/yaml/dist/log.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/merge.js
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
    value = ctx && identity.isAlias(value) ? value.resolve(ctx.doc) : value;
    if (identity.isSeq(value))
      for (const it of value.items)
        mergeValue(ctx, map, it);
    else if (Array.isArray(value))
      for (const it of value)
        mergeValue(ctx, map, it);
    else
      mergeValue(ctx, map, value);
  }
  function mergeValue(ctx, map, value) {
    const source = ctx && identity.isAlias(value) ? value.resolve(ctx.doc) : value;
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
  exports.addMergeToJSMap = addMergeToJSMap;
  exports.isMergeKey = isMergeKey;
  exports.merge = merge;
});

// ../../node_modules/yaml/dist/nodes/addPairToJSMap.js
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

// ../../node_modules/yaml/dist/nodes/Pair.js
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

// ../../node_modules/yaml/dist/stringify/stringifyCollection.js
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
      if (i < items.length - 1)
        str += ",";
      if (comment)
        str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
      if (!reqNewline && (lines.length > linesAtValue || str.includes(`
`)))
        reqNewline = true;
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

// ../../node_modules/yaml/dist/nodes/YAMLMap.js
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

// ../../node_modules/yaml/dist/schema/common/map.js
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

// ../../node_modules/yaml/dist/nodes/YAMLSeq.js
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

// ../../node_modules/yaml/dist/schema/common/seq.js
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

// ../../node_modules/yaml/dist/schema/common/string.js
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

// ../../node_modules/yaml/dist/schema/common/null.js
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

// ../../node_modules/yaml/dist/schema/core/bool.js
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

// ../../node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS((exports) => {
  function stringifyNumber({ format, minFractionDigits, tag, value }) {
    if (typeof value === "bigint")
      return String(value);
    const num = typeof value === "number" ? value : Number(value);
    if (!isFinite(num))
      return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
    let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
    if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^\d/.test(n)) {
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

// ../../node_modules/yaml/dist/schema/core/float.js
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

// ../../node_modules/yaml/dist/schema/core/int.js
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

// ../../node_modules/yaml/dist/schema/core/schema.js
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

// ../../node_modules/yaml/dist/schema/json/schema.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/binary.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/pairs.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/omap.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/bool.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/float.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/int.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/set.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
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

// ../../node_modules/yaml/dist/schema/yaml-1.1/schema.js
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

// ../../node_modules/yaml/dist/schema/tags.js
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

// ../../node_modules/yaml/dist/schema/Schema.js
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

// ../../node_modules/yaml/dist/stringify/stringifyDocument.js
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

// ../../node_modules/yaml/dist/doc/Document.js
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

// ../../node_modules/yaml/dist/errors.js
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

// ../../node_modules/yaml/dist/compose/resolve-props.js
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

// ../../node_modules/yaml/dist/compose/util-contains-newline.js
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

// ../../node_modules/yaml/dist/compose/util-flow-indent-check.js
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

// ../../node_modules/yaml/dist/compose/util-map-includes.js
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

// ../../node_modules/yaml/dist/compose/resolve-block-map.js
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

// ../../node_modules/yaml/dist/compose/resolve-block-seq.js
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

// ../../node_modules/yaml/dist/compose/resolve-end.js
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

// ../../node_modules/yaml/dist/compose/resolve-flow-collection.js
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

// ../../node_modules/yaml/dist/compose/compose-collection.js
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

// ../../node_modules/yaml/dist/compose/resolve-block-scalar.js
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

// ../../node_modules/yaml/dist/compose/resolve-flow-scalar.js
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
          const length = { x: 2, u: 4, U: 8 }[next];
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
    if (isNaN(code)) {
      const raw = source.substr(offset - 2, length + 2);
      onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
      return raw;
    }
    return String.fromCodePoint(code);
  }
  exports.resolveFlowScalar = resolveFlowScalar;
});

// ../../node_modules/yaml/dist/compose/compose-scalar.js
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

// ../../node_modules/yaml/dist/compose/util-empty-scalar-position.js
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

// ../../node_modules/yaml/dist/compose/compose-node.js
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
        node = composeCollection.composeCollection(CN, ctx, token, props, onError);
        if (anchor)
          node.anchor = anchor.source.substring(1);
        break;
      default: {
        const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
        onError(token, "UNEXPECTED_TOKEN", message);
        node = composeEmptyNode(ctx, token.offset, undefined, null, props, onError);
        isSrcToken = false;
      }
    }
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

// ../../node_modules/yaml/dist/compose/compose-doc.js
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

// ../../node_modules/yaml/dist/compose/composer.js
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

// ../../node_modules/yaml/dist/parse/cst-scalar.js
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

// ../../node_modules/yaml/dist/parse/cst-stringify.js
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

// ../../node_modules/yaml/dist/parse/cst-visit.js
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

// ../../node_modules/yaml/dist/parse/cst.js
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

// ../../node_modules/yaml/dist/parse/lexer.js
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

// ../../node_modules/yaml/dist/parse/line-counter.js
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

// ../../node_modules/yaml/dist/parse/parser.js
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

// ../../node_modules/yaml/dist/public-api.js
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

// ../../node_modules/yaml/dist/index.js
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

// ../../packages/extension-sdk/src/platform.ts
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
class PlatformAdapter {
  get name() {
    return this.constructor.name;
  }
}
// ../../packages/extension-sdk/src/message.ts
function isTextPart(part) {
  return "text" in part || "thought" in part || "thoughtSignatures" in part;
}
function isThoughtTextPart(part) {
  return "text" in part && part.thought === true;
}
function isInlineDataPart(part) {
  return "inlineData" in part;
}
function isFunctionCallPart(part) {
  return "functionCall" in part;
}
function isFunctionResponsePart(part) {
  return "functionResponse" in part;
}
// ../../packages/extension-sdk/src/logger.ts
function print(level, scope, args) {
  const consoleMethod = console[level] ?? console.log;
  consoleMethod(`[${scope}]`, ...args);
}
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    info: (...args) => print("log", scope, args),
    warn: (...args) => print("warn", scope, args),
    error: (...args) => print("error", scope, args),
    debug: (...args) => print("debug", scope, args)
  };
}
// src/web-platform.ts
import * as crypto4 from "crypto";
import * as http from "http";
import * as fs8 from "fs";
import * as path11 from "path";
import { fileURLToPath } from "url";

// src/router.ts
class Router {
  routes = [];
  add(method, path, handler) {
    const paramNames = [];
    const regexStr = path.replace(/:([a-zA-Z_]+)/g, (_match, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler
    });
  }
  get(path, handler) {
    this.add("GET", path, handler);
  }
  post(path, handler) {
    this.add("POST", path, handler);
  }
  put(path, handler) {
    this.add("PUT", path, handler);
  }
  delete(path, handler) {
    this.add("DELETE", path, handler);
  }
  async handle(req, res) {
    const method = req.method?.toUpperCase() ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    for (const route of this.routes) {
      if (route.method !== method)
        continue;
      const match = pathname.match(route.pattern);
      if (!match)
        continue;
      const params = {};
      try {
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
      } catch {
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
      }
      await route.handler(req, res, params);
      return true;
    }
    return false;
  }
}
var MAX_BODY_SIZE = 100 * 1024 * 1024;
function readRawBody(req, maxBodySize = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    req.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxBodySize) {
        req.destroy();
        reject(new Error("请求体过大"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}
async function readBody(req, maxBodySize = MAX_BODY_SIZE) {
  const rawBody = await readRawBody(req, maxBodySize);
  try {
    const body = rawBody.toString("utf-8");
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error("请求体 JSON 解析失败");
  }
}
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

// src/cloudflare.ts
import * as fs from "fs";
import * as path from "path";
function parseYAML(content) {
  try {
    const yaml = require_dist();
    return yaml.parse(content);
  } catch {
    return;
  }
}
function stringifyYAML(value) {
  try {
    const yaml = require_dist();
    return yaml.stringify(value, { indent: 2 });
  } catch {
    return JSON.stringify(value, null, 2);
  }
}
function readCloudflareYaml(configDir) {
  const filePath = path.join(configDir, "cloudflare.yaml");
  if (!fs.existsSync(filePath))
    return;
  return parseYAML(fs.readFileSync(filePath, "utf-8")) ?? undefined;
}
function writeCloudflareYaml(configDir, data) {
  const filePath = path.join(configDir, "cloudflare.yaml");
  if (data === undefined || typeof data === "object" && data !== null && Object.keys(data).length === 0) {
    if (fs.existsSync(filePath))
      fs.unlinkSync(filePath);
    return;
  }
  fs.writeFileSync(filePath, stringifyYAML(data), "utf-8");
}
function normalizeDomain(domain) {
  return (domain ?? "").trim().replace(/\.$/, "").toLowerCase();
}
function loadCloudflareRawConfig(configDir) {
  const cloudflare = readCloudflareYaml(configDir);
  if (!cloudflare || typeof cloudflare !== "object" || Array.isArray(cloudflare)) {
    return {};
  }
  return cloudflare;
}
function saveCloudflareConfig(configDir, patch) {
  const current = loadCloudflareRawConfig(configDir);
  const merged = { ...current, ...patch };
  for (const key of Object.keys(merged)) {
    if (merged[key] === null)
      delete merged[key];
  }
  writeCloudflareYaml(configDir, Object.keys(merged).length > 0 ? merged : undefined);
}
function resolveCloudflareConfig(configDir) {
  const raw = loadCloudflareRawConfig(configDir);
  const inlineToken = typeof raw.apiToken === "string" ? raw.apiToken.trim() : "";
  if (inlineToken) {
    return {
      configured: true,
      token: inlineToken,
      tokenSource: "inline",
      zoneId: typeof raw.zoneId === "string" && raw.zoneId.trim() ? raw.zoneId.trim() : null
    };
  }
  const envName = typeof raw.apiTokenEnv === "string" ? raw.apiTokenEnv.trim() : "";
  if (envName) {
    const envToken = process.env[envName]?.trim() || "";
    return {
      configured: true,
      token: envToken,
      tokenSource: "env",
      zoneId: typeof raw.zoneId === "string" && raw.zoneId.trim() ? raw.zoneId.trim() : null,
      ...envToken ? {} : { error: `环境变量 ${envName} 未设置或为空` }
    };
  }
  const filePath = typeof raw.apiTokenFile === "string" ? raw.apiTokenFile.trim() : "";
  if (filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath);
    try {
      const fileToken = fs.readFileSync(absolutePath, "utf-8").trim();
      return {
        configured: true,
        token: fileToken,
        tokenSource: "file",
        zoneId: typeof raw.zoneId === "string" && raw.zoneId.trim() ? raw.zoneId.trim() : null,
        ...fileToken ? {} : { error: `文件 ${absolutePath} 中未读取到有效 Token` }
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        configured: true,
        token: "",
        tokenSource: "file",
        zoneId: typeof raw.zoneId === "string" && raw.zoneId.trim() ? raw.zoneId.trim() : null,
        error: `读取 Token 文件失败: ${detail}`
      };
    }
  }
  return {
    configured: false,
    token: "",
    tokenSource: null,
    zoneId: null
  };
}
function buildCloudflareError(body, status) {
  const messages = Array.isArray(body.errors) ? body.errors.map((item) => {
    if (typeof item === "string")
      return item;
    if (item && typeof item === "object" && typeof item.message === "string")
      return item.message;
    return "";
  }).filter(Boolean) : [];
  return messages[0] || `Cloudflare API 请求失败（HTTP ${status}）`;
}
async function requestCloudflare(apiToken, apiPath, init) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiToken}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    ...init,
    headers
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false || body.result === undefined) {
    throw new Error(buildCloudflareError(body, res.status));
  }
  return body.result;
}
async function listCloudflareZones(apiToken) {
  const result = await requestCloudflare(apiToken, "/zones?per_page=100&order=name&direction=asc");
  return result.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status }));
}
async function getCloudflareSslMode(apiToken, zoneId) {
  const result = await requestCloudflare(apiToken, `/zones/${encodeURIComponent(zoneId)}/settings/ssl`);
  const mode = typeof result.value === "string" ? result.value : "unknown";
  if (mode === "off" || mode === "flexible" || mode === "full" || mode === "strict")
    return mode;
  return "unknown";
}
async function setCloudflareSslMode(apiToken, zoneId, mode) {
  const result = await requestCloudflare(apiToken, `/zones/${encodeURIComponent(zoneId)}/settings/ssl`, {
    method: "PATCH",
    body: JSON.stringify({ value: mode })
  });
  const nextMode = typeof result.value === "string" ? result.value : mode;
  if (nextMode === "off" || nextMode === "flexible" || nextMode === "full" || nextMode === "strict")
    return nextMode;
  return "unknown";
}
async function listCloudflareDnsRecords(apiToken, zoneId, name) {
  const params = new URLSearchParams({ per_page: "100" });
  const normalizedName = normalizeDomain(name);
  if (normalizedName)
    params.set("name", normalizedName);
  const result = await requestCloudflare(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records?${params.toString()}`);
  return result.map((record) => ({
    id: record.id,
    type: record.type,
    name: record.name,
    content: record.content,
    proxied: !!record.proxied,
    ttl: typeof record.ttl === "number" ? record.ttl : 1
  }));
}
async function addCloudflareDnsRecord(apiToken, zoneId, record) {
  const payload = {
    type: record.type,
    name: record.name.trim(),
    content: record.content.trim(),
    ttl: record.ttl ?? 1
  };
  if (record.type === "A" || record.type === "AAAA" || record.type === "CNAME") {
    payload.proxied = record.proxied ?? true;
  }
  await requestCloudflare(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
async function removeCloudflareDnsRecord(apiToken, zoneId, recordId) {
  await requestCloudflare(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
    method: "DELETE"
  });
}
function resolveActiveZone(zones, preferredZoneId) {
  if (preferredZoneId && preferredZoneId !== "auto") {
    return zones.find((zone) => zone.id === preferredZoneId) || null;
  }
  return zones[0] || null;
}
function findMatchingZone(zones, domain) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain)
    return null;
  let matched = null;
  for (const zone of zones) {
    const zoneName = normalizeDomain(zone.name);
    if (!zoneName)
      continue;
    if (normalizedDomain === zoneName || normalizedDomain.endsWith(`.${zoneName}`)) {
      if (!matched || zoneName.length > matched.name.length)
        matched = zone;
    }
  }
  return matched;
}
async function getCloudflareStatus(configDir, requestedZoneId) {
  const resolved = resolveCloudflareConfig(configDir);
  if (!resolved.configured) {
    return { configured: false, connected: false, zones: [], activeZoneId: null, activeZoneName: null, sslMode: null, tokenSource: null };
  }
  if (!resolved.token) {
    return { configured: true, connected: false, zones: [], activeZoneId: null, activeZoneName: null, sslMode: null, tokenSource: resolved.tokenSource, error: resolved.error || "未读取到 Cloudflare API Token" };
  }
  try {
    const zones = await listCloudflareZones(resolved.token);
    const activeZone = resolveActiveZone(zones, requestedZoneId ?? resolved.zoneId);
    const sslMode = activeZone ? await getCloudflareSslMode(resolved.token, activeZone.id) : null;
    return { configured: true, connected: true, zones, activeZoneId: activeZone?.id || null, activeZoneName: activeZone?.name || null, sslMode, tokenSource: resolved.tokenSource };
  } catch (error) {
    return { configured: true, connected: false, zones: [], activeZoneId: null, activeZoneName: null, sslMode: null, tokenSource: resolved.tokenSource, error: error instanceof Error ? error.message : String(error) };
  }
}
async function getCloudflareDeployContext(configDir, domain) {
  const normalizedDomain = normalizeDomain(domain);
  const resolved = resolveCloudflareConfig(configDir);
  if (!resolved.configured)
    return null;
  if (!resolved.token) {
    return { configured: true, connected: false, zoneId: null, zoneName: null, sslMode: null, domain: normalizedDomain || null, domainRecordProxied: null, tokenSource: resolved.tokenSource, error: resolved.error || "未读取到 Cloudflare API Token" };
  }
  try {
    const zones = await listCloudflareZones(resolved.token);
    const matchedZone = normalizedDomain ? findMatchingZone(zones, normalizedDomain) || resolveActiveZone(zones, resolved.zoneId) : resolveActiveZone(zones, resolved.zoneId);
    if (!matchedZone) {
      return { configured: true, connected: true, zoneId: null, zoneName: null, sslMode: null, domain: normalizedDomain || null, domainRecordProxied: null, tokenSource: resolved.tokenSource, ...normalizedDomain ? { error: `未找到与域名 ${normalizedDomain} 匹配的 Cloudflare Zone` } : {} };
    }
    const [sslMode, dnsRecords] = await Promise.all([
      getCloudflareSslMode(resolved.token, matchedZone.id),
      normalizedDomain ? listCloudflareDnsRecords(resolved.token, matchedZone.id, normalizedDomain) : Promise.resolve([])
    ]);
    const exactRecord = normalizedDomain ? dnsRecords.find((record) => normalizeDomain(record.name) === normalizedDomain && (record.type === "A" || record.type === "AAAA" || record.type === "CNAME")) : undefined;
    return { configured: true, connected: true, zoneId: matchedZone.id, zoneName: matchedZone.name, sslMode, domain: normalizedDomain || null, domainRecordProxied: exactRecord ? exactRecord.proxied : null, tokenSource: resolved.tokenSource };
  } catch (error) {
    return { configured: true, connected: false, zoneId: null, zoneName: null, sslMode: null, domain: normalizedDomain || null, domainRecordProxied: null, tokenSource: resolved.tokenSource, error: error instanceof Error ? error.message : String(error) };
  }
}

// src/handlers/cloudflare.ts
function getQueryValue(req, key) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const value = url.searchParams.get(key);
  return value && value.trim() ? value.trim() : null;
}
async function resolveZoneId(configDir, requestedZoneId) {
  const status = await getCloudflareStatus(configDir, requestedZoneId);
  if (!status.connected || !status.activeZoneId) {
    throw new Error(status.error || "Cloudflare 未连接或未选择可用 Zone");
  }
  return status.activeZoneId;
}
async function resolveApiToken(configDir) {
  const resolved = resolveCloudflareConfig(configDir);
  if (!resolved.token) {
    throw new Error(resolved.error || "未配置 Cloudflare API Token");
  }
  return resolved.token;
}
function createCloudflareHandlers(configDir) {
  return {
    async status(_req, res) {
      try {
        const result = await getCloudflareStatus(configDir);
        sendJSON(res, 200, result);
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
    async setup(req, res) {
      try {
        const body = await readBody(req);
        const apiToken = typeof body.apiToken === "string" ? body.apiToken.trim() : "";
        if (!apiToken) {
          sendJSON(res, 400, { ok: false, error: "请输入 Cloudflare API Token" });
          return;
        }
        const zones = await listCloudflareZones(apiToken);
        saveCloudflareConfig(configDir, {
          apiToken,
          apiTokenEnv: null,
          apiTokenFile: null,
          zoneId: zones.length === 1 ? zones[0].id : "auto"
        });
        sendJSON(res, 200, {
          ok: true,
          zones: zones.map((zone) => ({ id: zone.id, name: zone.name }))
        });
      } catch (error) {
        sendJSON(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error), zones: [] });
      }
    },
    async listDns(req, res) {
      try {
        const token = await resolveApiToken(configDir);
        const zoneId = await resolveZoneId(configDir, getQueryValue(req, "zoneId"));
        const records = await listCloudflareDnsRecords(token, zoneId);
        sendJSON(res, 200, { records });
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
    async addDns(req, res) {
      try {
        const body = await readBody(req);
        const token = await resolveApiToken(configDir);
        const zoneIdInput = typeof body.zoneId === "string" ? body.zoneId.trim() : "";
        const zoneId = await resolveZoneId(configDir, zoneIdInput || null);
        await addCloudflareDnsRecord(token, zoneId, {
          type: typeof body.type === "string" ? body.type.trim().toUpperCase() : "",
          name: typeof body.name === "string" ? body.name.trim() : "",
          content: typeof body.content === "string" ? body.content.trim() : "",
          proxied: typeof body.proxied === "boolean" ? body.proxied : undefined,
          ttl: typeof body.ttl === "number" ? body.ttl : undefined
        });
        sendJSON(res, 200, { ok: true });
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
    async removeDns(req, res, params) {
      try {
        const token = await resolveApiToken(configDir);
        const zoneId = await resolveZoneId(configDir, getQueryValue(req, "zoneId"));
        await removeCloudflareDnsRecord(token, zoneId, params.id);
        sendJSON(res, 200, { ok: true });
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
    async getSsl(req, res) {
      try {
        const token = await resolveApiToken(configDir);
        const zoneId = await resolveZoneId(configDir, getQueryValue(req, "zoneId"));
        const mode = await getCloudflareSslMode(token, zoneId);
        sendJSON(res, 200, { mode });
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
    async setSsl(req, res) {
      try {
        const body = await readBody(req);
        const mode = typeof body.mode === "string" ? body.mode.trim() : "";
        if (mode !== "off" && mode !== "flexible" && mode !== "full" && mode !== "strict") {
          sendJSON(res, 400, { error: "无效的 SSL 模式" });
          return;
        }
        const token = await resolveApiToken(configDir);
        const zoneIdInput = typeof body.zoneId === "string" ? body.zoneId.trim() : "";
        const zoneId = await resolveZoneId(configDir, zoneIdInput || null);
        const appliedMode = await setCloudflareSslMode(token, zoneId, mode);
        sendJSON(res, 200, { ok: true, mode: appliedMode });
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}

// src/handlers/deploy.ts
import * as crypto from "crypto";
import * as fs2 from "fs";
import * as os from "os";
import * as path2 from "path";
import { execFile } from "child_process";
import { promisify } from "util";
var yaml = __toESM(require_dist(), 1);
function loadRawConfigDir(configDir) {
  const result = {};
  const sections = ["llm", "ocr", "platform", "storage", "tools", "system", "memory", "cloudflare", "mcp", "modes", "sub_agents", "summary", "plugins"];
  for (const key of sections) {
    const filePath = path2.join(configDir, `${key}.yaml`);
    if (fs2.existsSync(filePath)) {
      try {
        result[key] = yaml.parse(fs2.readFileSync(filePath, "utf-8"));
      } catch {}
    }
  }
  return result;
}
function parsePlatformConfig(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const types = (() => {
    const envPlatform = process.env.IRIS_PLATFORM;
    if (envPlatform)
      return envPlatform.split(",").map((s) => s.trim()).filter(Boolean);
    const rawType = source.type;
    if (typeof rawType === "string")
      return rawType.split(",").map((s) => s.trim()).filter(Boolean);
    if (Array.isArray(rawType))
      return rawType.filter((t) => typeof t === "string").map((s) => s.trim()).filter(Boolean);
    return ["web"];
  })();
  return {
    types,
    web: {
      port: source.web?.port ?? 8192,
      host: source.web?.host ?? "127.0.0.1",
      lastModel: source.web?.lastModel,
      authToken: source.web?.authToken,
      managementToken: source.web?.managementToken
    },
    ...Object.fromEntries(Object.entries(source).filter(([k]) => k !== "type" && k !== "pairing" && k !== "web"))
  };
}
var execFileAsync = promisify(execFile);
var NGINX_TARGET_PATH = "/etc/nginx/sites-available/iris";
var NGINX_LINK_PATH = "/etc/nginx/sites-enabled/iris";
var SERVICE_TARGET_PATH = "/etc/systemd/system/iris.service";
var HTPASSWD_PATH = "/etc/nginx/.htpasswd";
var CERTBOT_WEBROOT = "/var/www/certbot";
function isRootUser() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}
function isLinuxHost() {
  return process.platform === "linux";
}
function normalizeLoopback(address) {
  return address.replace(/^::ffff:/, "").trim().toLowerCase();
}
function isLoopbackAddress(address) {
  const normalized = normalizeLoopback(address);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}
function getHeader(req, key) {
  const value = req.headers[key];
  if (Array.isArray(value))
    return value[0]?.trim() || "";
  return typeof value === "string" ? value.trim() : "";
}
function getClientAddress(req) {
  const realIp = getHeader(req, "x-real-ip");
  if (realIp)
    return realIp;
  const forwardedFor = getHeader(req, "x-forwarded-for");
  if (forwardedFor)
    return forwardedFor.split(",")[0]?.trim() || forwardedFor;
  return req.socket.remoteAddress || "";
}
function readDeployToken(req) {
  return getHeader(req, "x-deploy-token");
}
function safeEqual(left, right) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length)
    return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}
function assertDeployToken(req, res, expectedToken) {
  const presented = readDeployToken(req);
  if (!presented || !safeEqual(presented, expectedToken)) {
    sendJSON(res, 401, {
      error: "未授权：缺少或无效的部署令牌",
      code: "DEPLOY_TOKEN_INVALID"
    });
    return false;
  }
  return true;
}
async function pathExists(targetPath) {
  try {
    await fs2.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
function formatCommandError(error) {
  if (error && typeof error === "object") {
    const err = error;
    const detail = [err.stderr, err.stdout, err.message].map((item) => (item || "").trim()).filter(Boolean)[0];
    if (detail)
      return detail;
  }
  return error instanceof Error ? error.message : String(error);
}
async function runCommand(command, args, options = {}) {
  const useSudo = !!options.sudo && !isRootUser();
  const executable = useSudo ? "sudo" : command;
  const executableArgs = useSudo ? ["-n", command, ...args] : args;
  try {
    const { stdout = "", stderr = "" } = await execFileAsync(executable, executableArgs, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error;
    const result = {
      ok: false,
      stdout: err.stdout || "",
      stderr: err.stderr || formatCommandError(error),
      exitCode: typeof err.code === "number" ? err.code : 1
    };
    if (options.allowFailure) {
      return result;
    }
    throw new Error(result.stderr.trim() || result.stdout.trim() || "命令执行失败");
  }
}
async function commandExists(command) {
  const result = await runCommand("which", [command], { allowFailure: true });
  return result.ok;
}
async function detectNginxVersion() {
  const result = await runCommand("nginx", ["-v"], { allowFailure: true });
  const output = `${result.stdout}
${result.stderr}`;
  const match = output.match(/nginx\/([^\s]+)/);
  return match?.[1] || "";
}
async function detectServiceStatus() {
  const result = await runCommand("systemctl", ["is-active", "iris"], { allowFailure: true });
  return (result.stdout || result.stderr).trim() || "unknown";
}
async function detectSudoState() {
  if (!isLinuxHost()) {
    return { available: false, noPassword: false };
  }
  if (isRootUser()) {
    return { available: true, noPassword: true };
  }
  const available = await commandExists("sudo");
  if (!available) {
    return { available: false, noPassword: false };
  }
  const result = await runCommand("sudo", ["-n", "true"], { allowFailure: true });
  return {
    available: true,
    noPassword: result.ok
  };
}
function normalizeDeployPath(value) {
  return value.trim().replace(/\\/g, "/");
}
function normalizeOptions(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const portValue = typeof source.port === "number" ? source.port : Number(source.port);
  return {
    domain: typeof source.domain === "string" ? source.domain.trim() : "",
    port: Number.isFinite(portValue) ? Math.trunc(portValue) : 8192,
    deployPath: normalizeDeployPath(typeof source.deployPath === "string" ? source.deployPath : process.cwd()),
    user: typeof source.user === "string" ? source.user.trim() : "",
    enableHttps: !!source.enableHttps,
    enableAuth: !!source.enableAuth
  };
}
function buildNginxConfig(options) {
  const authBlock = options.enableAuth ? [
    '    auth_basic "Iris";',
    `    auth_basic_user_file ${HTPASSWD_PATH};`,
    ""
  ].join(`
`) : "";
  const sharedProxy = [
    "        proxy_http_version 1.1;",
    "",
    "        proxy_set_header Host $host;",
    "        proxy_set_header X-Real-IP $remote_addr;",
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "        proxy_set_header X-Forwarded-Proto $scheme;"
  ].join(`
`);
  const sseBlock = [
    "    # SSE 专用：/api/chat",
    "    location /api/chat {",
    `        proxy_pass http://127.0.0.1:${options.port};`,
    "",
    "        proxy_buffering off;",
    "        proxy_cache off;",
    "        chunked_transfer_encoding off;",
    "",
    "        proxy_read_timeout 300s;",
    "        proxy_send_timeout 300s;",
    "",
    "        proxy_set_header Connection '';",
    sharedProxy,
    "    }"
  ].join(`
`);
  const webBlock = [
    "    location / {",
    `        proxy_pass http://127.0.0.1:${options.port};`,
    sharedProxy,
    "",
    "        proxy_set_header Upgrade $http_upgrade;",
    '        proxy_set_header Connection "upgrade";',
    "    }"
  ].join(`
`);
  if (!options.enableHttps) {
    return [
      "# ==========================================",
      "#  Iris Nginx 配置（HTTP-only）",
      "# ==========================================",
      "",
      "server {",
      "    listen 80;",
      "    listen [::]:80;",
      `    server_name ${options.domain};`,
      "",
      "    location /.well-known/acme-challenge/ {",
      `        root ${CERTBOT_WEBROOT};`,
      "    }",
      "",
      authBlock,
      sseBlock,
      "",
      webBlock,
      "}",
      ""
    ].join(`
`);
  }
  return [
    "# ==========================================",
    "#  Iris Nginx 配置（HTTPS）",
    "# ==========================================",
    "",
    "server {",
    "    listen 80;",
    "    listen [::]:80;",
    `    server_name ${options.domain};`,
    "",
    "    location /.well-known/acme-challenge/ {",
    `        root ${CERTBOT_WEBROOT};`,
    "    }",
    "",
    "    location / {",
    "        return 301 https://$host$request_uri;",
    "    }",
    "}",
    "",
    "server {",
    "    listen 443 ssl http2;",
    "    listen [::]:443 ssl http2;",
    `    server_name ${options.domain};`,
    "",
    `    ssl_certificate     /etc/letsencrypt/live/${options.domain}/fullchain.pem;`,
    `    ssl_certificate_key /etc/letsencrypt/live/${options.domain}/privkey.pem;`,
    "",
    "    ssl_protocols TLSv1.2 TLSv1.3;",
    "    ssl_ciphers HIGH:!aNULL:!MD5;",
    "    ssl_prefer_server_ciphers on;",
    "    ssl_session_cache shared:SSL:10m;",
    "    ssl_session_timeout 10m;",
    "",
    '    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;',
    "    add_header X-Frame-Options DENY always;",
    "    add_header X-Content-Type-Options nosniff always;",
    '    add_header X-XSS-Protection "1; mode=block" always;',
    '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    "",
    authBlock,
    sseBlock,
    "",
    webBlock,
    "}",
    ""
  ].join(`
`);
}
function buildServiceConfig(options) {
  return [
    "# ==========================================",
    "#  Iris systemd 服务文件",
    "# ==========================================",
    "",
    "[Unit]",
    "Description=Iris AI Chat Service",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${options.deployPath}`,
    `ExecStart=${path2.posix.join(options.deployPath, "bin", "iris")} serve`,
    `User=${options.user}`,
    `Group=${options.user}`,
    "Environment=NODE_ENV=production",
    `Environment=IRIS_DATA_DIR=${path2.posix.join(options.deployPath, ".iris")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "StandardOutput=journal",
    "StandardError=journal",
    "NoNewPrivileges=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    `ReadWritePaths=${path2.posix.join(options.deployPath, ".iris")}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ].join(`
`);
}
async function buildPreview(configDir, rawOptions) {
  const options = normalizeOptions(rawOptions);
  const effectiveDomain = options.domain || "chat.example.com";
  const previewOptions = {
    ...options,
    domain: effectiveDomain
  };
  const errors = [];
  const warnings = [];
  const recommendations = [];
  if (!options.domain) {
    errors.push("请填写域名后再部署");
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    errors.push("后端端口必须在 1-65535 之间");
  }
  if (!options.deployPath) {
    errors.push("请填写部署路径");
  } else if (!options.deployPath.startsWith("/")) {
    errors.push("部署路径必须是 Linux 绝对路径");
  }
  if (!options.user) {
    errors.push("请填写运行用户");
  }
  if (isLinuxHost()) {
    if (options.user) {
      const userExists = await runCommand("id", ["-u", options.user], { allowFailure: true });
      if (!userExists.ok) {
        errors.push(`未检测到运行用户 ${options.user}，请先创建该用户`);
      }
    }
    if (options.deployPath) {
      const deployPathExists = await pathExists(options.deployPath);
      if (!deployPathExists) {
        errors.push(`部署路径不存在：${options.deployPath}`);
      } else {
        const binaryEntrypoint = path2.join(options.deployPath, "bin", "iris");
        if (!await pathExists(binaryEntrypoint)) {
          warnings.push(`未检测到 ${binaryEntrypoint}，请确认已解压 GitHub Release 或完成二进制构建`);
        }
      }
    }
    if (options.enableHttps && options.domain) {
      const fullchain = `/etc/letsencrypt/live/${effectiveDomain}/fullchain.pem`;
      const privkey = `/etc/letsencrypt/live/${effectiveDomain}/privkey.pem`;
      if (!await pathExists(fullchain) || !await pathExists(privkey)) {
        errors.push(`未检测到 ${effectiveDomain} 的 HTTPS 证书。请先以 HTTP-only 模式部署并申请证书，再启用 HTTPS。`);
      }
    }
    if (options.enableAuth && !await pathExists(HTPASSWD_PATH)) {
      errors.push(`已启用密码保护，但未找到 ${HTPASSWD_PATH}`);
    }
  }
  const cloudflare = await getCloudflareDeployContext(configDir, options.domain || null);
  if (cloudflare?.connected) {
    if (!options.enableHttps && (cloudflare.sslMode === "full" || cloudflare.sslMode === "strict")) {
      warnings.push("当前 Cloudflare SSL 为 Full/Strict，而源站计划使用 HTTP-only。部署后请同步为 Flexible，避免 521/525 错误。");
    }
    if (options.enableHttps && cloudflare.sslMode === "flexible") {
      recommendations.push("源站启用 HTTPS 后，建议将 Cloudflare SSL 切换到 Full (Strict)。");
    }
    if (options.enableHttps && cloudflare.domainRecordProxied === false) {
      recommendations.push("当前域名记录未开启 Cloudflare 代理，如需 CDN/防护可在 Cloudflare 管理中开启。");
    }
  }
  if (!options.enableHttps) {
    recommendations.push("HTTP-only 模式适合首次上线和 Cloudflare Flexible；拿到证书后建议重新部署为 HTTPS。");
  }
  if (options.enableAuth) {
    recommendations.push("启用 Basic Auth 后，请妥善保管 /etc/nginx/.htpasswd 中的账号信息。");
  }
  return {
    options: previewOptions,
    nginxConfig: buildNginxConfig(previewOptions),
    serviceConfig: buildServiceConfig(previewOptions),
    warnings,
    errors,
    recommendations,
    cloudflare
  };
}
async function writeInstalledFile(targetPath, content) {
  const tempDir = await fs2.promises.mkdtemp(path2.join(os.tmpdir(), "iris-deploy-"));
  const tempFile = path2.join(tempDir, path2.basename(targetPath));
  try {
    await fs2.promises.writeFile(tempFile, content, "utf-8");
    await runCommand("install", ["-m", "644", tempFile, targetPath], { sudo: true });
  } finally {
    await fs2.promises.rm(tempDir, { recursive: true, force: true });
  }
}
async function runDeployStep(steps, name, action) {
  try {
    const output = await action();
    steps.push({
      name,
      success: true,
      output: typeof output === "string" && output.trim() ? output.trim() : "完成"
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    steps.push({ name, success: false, output: detail });
    throw error;
  }
}
async function ensureEnvironmentReady(req, target) {
  const detect = await detectEnvironment(req);
  if (!detect.isLinux)
    return { detect, error: "仅支持 Linux 系统部署" };
  if (!detect.isLocal)
    return { detect, error: "仅允许本地访问部署接口" };
  if (!detect.sudo.available || !detect.sudo.noPassword)
    return { detect, error: "当前环境未配置免密 sudo，无法执行一键部署" };
  if (target === "nginx" && !detect.nginx.installed)
    return { detect, error: "未检测到 Nginx，请先安装" };
  if (target === "service" && !detect.systemd.available)
    return { detect, error: "当前系统未提供可用的 systemd" };
  return { detect };
}
async function detectEnvironment(req) {
  const isLinux = isLinuxHost();
  const clientAddress = getClientAddress(req);
  const isLocal = isLoopbackAddress(clientAddress);
  let nginxInstalled = false;
  let nginxVersion = "";
  let systemdAvailable = false;
  let systemdStatus = "";
  if (isLinux) {
    nginxInstalled = await commandExists("nginx");
    if (nginxInstalled) {
      nginxVersion = await detectNginxVersion();
    }
    const systemctlExists = await commandExists("systemctl");
    systemdAvailable = systemctlExists && await pathExists("/run/systemd/system");
    if (systemdAvailable) {
      systemdStatus = await detectServiceStatus();
    }
  }
  return {
    isLinux,
    isLocal,
    nginx: {
      installed: nginxInstalled,
      version: nginxVersion,
      configDir: "/etc/nginx/sites-available",
      existingConfig: await pathExists(NGINX_TARGET_PATH) || await pathExists(NGINX_LINK_PATH)
    },
    systemd: {
      available: systemdAvailable,
      existingService: await pathExists(SERVICE_TARGET_PATH),
      serviceStatus: systemdStatus
    },
    sudo: await detectSudoState()
  };
}
function loadPlatformWebState(configDir) {
  const raw = loadRawConfigDir(configDir);
  const parsed = parsePlatformConfig(raw.platform);
  return {
    host: parsed.web.host,
    port: parsed.web.port
  };
}
function getDefaultDeployUser() {
  return process.env.SUDO_USER || process.env.USER || os.userInfo().username || "iris";
}
async function resolveCloudflareSyncTarget(configDir, requestedZoneId) {
  const resolved = resolveCloudflareConfig(configDir);
  if (!resolved.token) {
    throw new Error(resolved.error || "未配置 Cloudflare API Token");
  }
  const status = await getCloudflareStatus(configDir, requestedZoneId);
  if (!status.connected || !status.activeZoneId) {
    throw new Error(status.error || "Cloudflare 未连接或未选择可用 Zone");
  }
  return {
    token: resolved.token,
    zoneId: status.activeZoneId
  };
}
function createDeployHandlers(configDir, getDeployToken) {
  return {
    async getState(_req, res) {
      try {
        const web = loadPlatformWebState(configDir);
        const defaults = {
          domain: "",
          port: web.port,
          deployPath: normalizeDeployPath(process.cwd()),
          user: getDefaultDeployUser(),
          enableHttps: true,
          enableAuth: false
        };
        const cloudflare = await getCloudflareDeployContext(configDir, null);
        sendJSON(res, 200, { web, defaults, cloudflare });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        sendJSON(res, 500, { error: detail });
      }
    },
    async detect(req, res) {
      try {
        const result = await detectEnvironment(req);
        sendJSON(res, 200, result);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        sendJSON(res, 500, { error: detail });
      }
    },
    async preview(req, res) {
      try {
        const body = await readBody(req);
        const result = await buildPreview(configDir, body.options);
        sendJSON(res, 200, result);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        sendJSON(res, 500, { error: detail });
      }
    },
    async deployNginx(req, res) {
      if (!assertDeployToken(req, res, getDeployToken()))
        return;
      const steps = [];
      try {
        const { error } = await ensureEnvironmentReady(req, "nginx");
        if (error) {
          sendJSON(res, 400, { ok: false, steps, error });
          return;
        }
        const body = await readBody(req);
        const preview = await buildPreview(configDir, body.options);
        if (preview.errors.length > 0) {
          sendJSON(res, 400, { ok: false, steps, error: preview.errors[0] });
          return;
        }
        await runDeployStep(steps, "写入 Nginx 配置", async () => {
          await runCommand("install", ["-d", CERTBOT_WEBROOT], { sudo: true });
          await writeInstalledFile(NGINX_TARGET_PATH, preview.nginxConfig);
          await runCommand("ln", ["-sfn", NGINX_TARGET_PATH, NGINX_LINK_PATH], { sudo: true });
          return `已写入 ${NGINX_TARGET_PATH}`;
        });
        await runDeployStep(steps, "校验 Nginx 配置", async () => {
          const result = await runCommand("nginx", ["-t"], { sudo: true });
          return (result.stdout || result.stderr).trim() || "nginx -t 通过";
        });
        await runDeployStep(steps, "重启 Nginx", async () => {
          const result = await runCommand("systemctl", ["restart", "nginx"], { sudo: true });
          return (result.stdout || result.stderr).trim() || "nginx 已重启";
        });
        sendJSON(res, 200, { ok: true, steps });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        sendJSON(res, 200, { ok: false, steps, error: detail });
      }
    },
    async deployService(req, res) {
      if (!assertDeployToken(req, res, getDeployToken()))
        return;
      const steps = [];
      try {
        const { error } = await ensureEnvironmentReady(req, "service");
        if (error) {
          sendJSON(res, 400, { ok: false, steps, error });
          return;
        }
        const body = await readBody(req);
        const preview = await buildPreview(configDir, body.options);
        if (preview.errors.length > 0) {
          sendJSON(res, 400, { ok: false, steps, error: preview.errors[0] });
          return;
        }
        await runDeployStep(steps, "写入 systemd 服务文件", async () => {
          await writeInstalledFile(SERVICE_TARGET_PATH, preview.serviceConfig);
          return `已写入 ${SERVICE_TARGET_PATH}`;
        });
        await runDeployStep(steps, "重新加载 systemd", async () => {
          const result = await runCommand("systemctl", ["daemon-reload"], { sudo: true });
          return (result.stdout || result.stderr).trim() || "systemd 配置已重新加载";
        });
        await runDeployStep(steps, "启用服务", async () => {
          const result = await runCommand("systemctl", ["enable", "iris"], { sudo: true });
          return (result.stdout || result.stderr).trim() || "服务已启用";
        });
        await runDeployStep(steps, "重启服务", async () => {
          const result = await runCommand("systemctl", ["restart", "iris"], { sudo: true });
          return (result.stdout || result.stderr).trim() || "服务已重启";
        });
        await runDeployStep(steps, "检查服务状态", async () => {
          const result = await runCommand("systemctl", ["--no-pager", "--full", "status", "iris"], { sudo: true });
          return (result.stdout || result.stderr).trim() || "服务状态正常";
        });
        sendJSON(res, 200, { ok: true, steps });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        sendJSON(res, 200, { ok: false, steps, error: detail });
      }
    },
    async syncCloudflare(req, res) {
      try {
        const body = await readBody(req);
        const mode = typeof body.mode === "string" ? body.mode.trim() : "";
        if (mode !== "flexible" && mode !== "full" && mode !== "strict") {
          sendJSON(res, 400, { ok: false, error: "无效的 Cloudflare SSL 模式" });
          return;
        }
        const zoneIdInput = typeof body.zoneId === "string" ? body.zoneId.trim() : "";
        const { token, zoneId } = await resolveCloudflareSyncTarget(configDir, zoneIdInput || null);
        const appliedMode = await setCloudflareSslMode(token, zoneId, mode);
        sendJSON(res, 200, { ok: true, mode: appliedMode });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        sendJSON(res, 500, { ok: false, error: detail });
      }
    }
  };
}

// src/handlers/chat.ts
import * as crypto2 from "crypto";

// src/chat-attachments.ts
var CHAT_ATTACHMENT_LIMITS = {
  maxImages: 4,
  maxImageBytes: 4 * 1024 * 1024,
  maxDocuments: 3,
  maxDocumentBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxMultipartBodyBytes: 24 * 1024 * 1024
};
function formatAttachmentBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

// src/handlers/chat.ts
var SUPPORTED_BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
]);
var SUPPORTED_TEXT_MIME_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/ld+json",
  "application/xml",
  "image/svg+xml",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml",
  "application/toml",
  "text/x-toml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-shellscript",
  "application/sql"
]);
var EXTENSION_TO_MIME = {
  ".md": "text/markdown",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".ts": "text/x-typescript",
  ".tsx": "text/x-typescript",
  ".jsx": "application/javascript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".rs": "text/x-rust",
  ".go": "text/x-go",
  ".java": "text/x-java",
  ".kt": "text/x-kotlin",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".cs": "text/x-csharp",
  ".swift": "text/x-swift",
  ".php": "text/x-php",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".zsh": "application/x-sh",
  ".sql": "application/sql",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".cfg": "text/plain",
  ".ini": "text/plain",
  ".env": "text/plain",
  ".conf": "text/plain",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel"
};
function isSupportedTextMime(mimeType) {
  return mimeType.startsWith("text/") || SUPPORTED_TEXT_MIME_TYPES.has(mimeType);
}
function isSupportedDocumentMime(mimeType, fileName) {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (SUPPORTED_BINARY_MIME_TYPES.has(normalized) || isSupportedTextMime(normalized))
    return true;
  const ext = fileName?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  if (!ext)
    return false;
  return !!EXTENSION_TO_MIME[ext];
}

class ChatRequestError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}
function normalizeMimeType(mimeType) {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}
function getContentType(req) {
  const header = req.headers["content-type"];
  return normalizeMimeType(Array.isArray(header) ? header[0] ?? "" : header ?? "");
}
function buildImageLimitError() {
  return `图片参数无效：最多支持 ${CHAT_ATTACHMENT_LIMITS.maxImages} 张 image/* 图片，且单张不超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxImageBytes)}`;
}
function buildDocumentLimitError() {
  return `文档参数无效：最多支持 ${CHAT_ATTACHMENT_LIMITS.maxDocuments} 个文档（PDF / Office / Markdown / JSON / XML / Python 等文本代码文件），且单个不超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxDocumentBytes)}`;
}
function buildTotalLimitError() {
  return `附件总量过大：图片与文档合计不能超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxTotalBytes)}`;
}
function decodeBase64ByteLength(base64) {
  try {
    return Buffer.from(base64, "base64").byteLength;
  } catch {
    return 0;
  }
}
function toRequestHeaders(headers) {
  const normalized = new Headers;
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        normalized.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      normalized.set(key, value);
    }
  }
  return normalized;
}
function normalizeImages(raw) {
  if (raw == null)
    return { items: [], totalBytes: 0 };
  if (!Array.isArray(raw) || raw.length > CHAT_ATTACHMENT_LIMITS.maxImages)
    return null;
  const images = [];
  let totalBytes = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : "";
    const rawData = typeof item.data === "string" ? item.data : "";
    const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    const normalizedMimeType = normalizeMimeType(dataUrlMatch?.[1] ?? mimeType);
    const normalizedData = dataUrlMatch?.[2] ?? rawData;
    const binarySize = decodeBase64ByteLength(normalizedData);
    if (!normalizedMimeType.startsWith("image/") || !normalizedData || binarySize <= 0 || binarySize > CHAT_ATTACHMENT_LIMITS.maxImageBytes) {
      return null;
    }
    totalBytes += binarySize;
    images.push({
      mimeType: normalizedMimeType,
      data: normalizedData
    });
  }
  return { items: images, totalBytes };
}
function normalizeDocuments(raw) {
  if (raw == null)
    return { items: [], totalBytes: 0 };
  if (!Array.isArray(raw) || raw.length > CHAT_ATTACHMENT_LIMITS.maxDocuments)
    return null;
  const documents = [];
  let totalBytes = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const fileName = typeof item.fileName === "string" ? item.fileName : "";
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : "";
    const rawData = typeof item.data === "string" ? item.data : "";
    const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    const normalizedMimeType = normalizeMimeType(dataUrlMatch?.[1] ?? mimeType);
    const normalizedData = dataUrlMatch?.[2] ?? rawData;
    const binarySize = decodeBase64ByteLength(normalizedData);
    if (!fileName || !normalizedData || !isSupportedDocumentMime(normalizedMimeType, fileName) || binarySize <= 0 || binarySize > CHAT_ATTACHMENT_LIMITS.maxDocumentBytes) {
      return null;
    }
    totalBytes += binarySize;
    documents.push({
      fileName,
      mimeType: normalizedMimeType || "application/octet-stream",
      data: normalizedData
    });
  }
  return { items: documents, totalBytes };
}
function assertTotalAttachmentBytes(totalBytes) {
  if (totalBytes > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
    throw new ChatRequestError(413, buildTotalLimitError());
  }
}
function resolveOptionalSessionId(raw) {
  if (typeof raw !== "string")
    return null;
  const value = raw.trim();
  return value ? value : null;
}
async function parseJsonChatRequest(req) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === "请求体过大") {
      throw new ChatRequestError(413, buildTotalLimitError());
    }
    throw new ChatRequestError(400, "请求体解析失败");
  }
  const message = typeof body.message === "string" ? body.message : "";
  const imagesResult = normalizeImages(body.images);
  const documentsResult = normalizeDocuments(body.documents);
  if (imagesResult === null) {
    throw new ChatRequestError(400, buildImageLimitError());
  }
  if (documentsResult === null) {
    throw new ChatRequestError(400, buildDocumentLimitError());
  }
  assertTotalAttachmentBytes(imagesResult.totalBytes + documentsResult.totalBytes);
  return {
    sessionId: resolveOptionalSessionId(body.sessionId),
    message,
    images: imagesResult.items,
    documents: documentsResult.items
  };
}
async function parseMultipartChatRequest(req) {
  let rawBody;
  try {
    rawBody = await readRawBody(req, CHAT_ATTACHMENT_LIMITS.maxMultipartBodyBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "请求体过大") {
      throw new ChatRequestError(413, buildTotalLimitError());
    }
    throw new ChatRequestError(400, "请求体解析失败");
  }
  let formData;
  try {
    const request = new Request("http://localhost/api/chat", {
      method: req.method ?? "POST",
      headers: toRequestHeaders(req.headers),
      body: rawBody
    });
    formData = await request.formData();
  } catch {
    throw new ChatRequestError(400, "multipart/form-data 解析失败");
  }
  const rawMessage = formData.get("message");
  if (rawMessage != null && typeof rawMessage !== "string") {
    throw new ChatRequestError(400, "message 参数无效");
  }
  const rawSessionId = formData.get("sessionId");
  if (rawSessionId != null && typeof rawSessionId !== "string") {
    throw new ChatRequestError(400, "sessionId 参数无效");
  }
  const imageEntries = formData.getAll("images");
  const documentEntries = formData.getAll("documents");
  if (imageEntries.length > CHAT_ATTACHMENT_LIMITS.maxImages) {
    throw new ChatRequestError(400, buildImageLimitError());
  }
  if (documentEntries.length > CHAT_ATTACHMENT_LIMITS.maxDocuments) {
    throw new ChatRequestError(400, buildDocumentLimitError());
  }
  const images = [];
  const documents = [];
  let totalBytes = 0;
  for (const entry of imageEntries) {
    if (!(entry instanceof File)) {
      throw new ChatRequestError(400, "图片参数无效：请使用 multipart 文件字段 images");
    }
    const mimeType = normalizeMimeType(entry.type);
    if (!mimeType.startsWith("image/")) {
      throw new ChatRequestError(400, buildImageLimitError());
    }
    if (entry.size <= 0) {
      throw new ChatRequestError(400, `${entry.name || "图片"} 为空文件，无法上传`);
    }
    if (entry.size > CHAT_ATTACHMENT_LIMITS.maxImageBytes) {
      throw new ChatRequestError(413, `${entry.name || "图片"} 超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxImageBytes)} 限制`);
    }
    totalBytes += entry.size;
    assertTotalAttachmentBytes(totalBytes);
    const buffer = Buffer.from(await entry.arrayBuffer());
    images.push({
      mimeType,
      data: buffer.toString("base64")
    });
  }
  for (const entry of documentEntries) {
    if (!(entry instanceof File)) {
      throw new ChatRequestError(400, "文档参数无效：请使用 multipart 文件字段 documents");
    }
    const fileName = entry.name || "document";
    const mimeType = normalizeMimeType(entry.type) || "application/octet-stream";
    if (!isSupportedDocumentMime(mimeType, fileName)) {
      throw new ChatRequestError(400, `${fileName}: 不支持的文档类型`);
    }
    if (entry.size <= 0) {
      throw new ChatRequestError(400, `${fileName} 为空文件，无法上传`);
    }
    if (entry.size > CHAT_ATTACHMENT_LIMITS.maxDocumentBytes) {
      throw new ChatRequestError(413, `${fileName} 超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxDocumentBytes)} 限制`);
    }
    totalBytes += entry.size;
    assertTotalAttachmentBytes(totalBytes);
    const buffer = Buffer.from(await entry.arrayBuffer());
    documents.push({
      fileName,
      mimeType,
      data: buffer.toString("base64")
    });
  }
  return {
    sessionId: resolveOptionalSessionId(rawSessionId),
    message: typeof rawMessage === "string" ? rawMessage : "",
    images,
    documents
  };
}
async function parseChatRequest(req) {
  const contentType = getContentType(req);
  if (!contentType || contentType === "application/json") {
    return parseJsonChatRequest(req);
  }
  if (contentType === "multipart/form-data") {
    return parseMultipartChatRequest(req);
  }
  throw new ChatRequestError(415, "仅支持 application/json 或 multipart/form-data 请求");
}
function createChatHandler(platform) {
  return async (req, res) => {
    let parsedRequest;
    try {
      parsedRequest = await parseChatRequest(req);
    } catch (error) {
      if (error instanceof ChatRequestError) {
        sendJSON(res, error.status, { error: error.message });
        return;
      }
      sendJSON(res, 400, { error: "请求体解析失败" });
      return;
    }
    const { message, images, documents } = parsedRequest;
    if (!message.trim() && images.length === 0 && documents.length === 0) {
      sendJSON(res, 400, { error: "消息、图片和文档不能同时为空" });
      return;
    }
    const sessionId = parsedRequest.sessionId ?? `web-${crypto2.randomUUID()}`;
    if (platform.hasPending(sessionId)) {
      sendJSON(res, 409, { error: "该会话有正在处理的请求" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Session-Id": sessionId
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    platform.registerPending(sessionId, res);
    res.on("close", () => {
      clearInterval(heartbeat);
      platform.removePending(sessionId);
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded)
        res.write(`: heartbeat

`);
    }, 15000);
    const agentName = typeof req.headers["x-agent-name"] === "string" ? req.headers["x-agent-name"] : undefined;
    try {
      await platform.dispatchMessage(sessionId, message, images, documents, agentName);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "done" })}

`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "error", message: errorMsg })}

`);
      }
    } finally {
      clearInterval(heartbeat);
      platform.removePending(sessionId);
      if (!res.writableEnded)
        res.end();
    }
  };
}

// src/message-format.ts
var OCR_TEXT_MARKER_RE = /^\[\[IRIS_OCR_IMAGE_(\d+)\]\]\n/;
function isOCRTextPart(part) {
  return isTextPart(part) && typeof part.text === "string" && OCR_TEXT_MARKER_RE.test(part.text);
}
var DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
]);
function isDocumentMimeType(mimeType) {
  return DOCUMENT_MIME_TYPES.has(mimeType);
}
function extractDocumentMarkerFileName(text) {
  const normalized = text?.trim() ?? "";
  if (!normalized.startsWith("[Document: "))
    return null;
  const match = normalized.match(/^\[Document: ([^\]\r\n]+)\]/);
  return match?.[1]?.trim() || null;
}
function isImageDimensionNote(text) {
  return /^\[Image: original \d+x\d+/.test(text?.trim() ?? "");
}
function formatContent(content) {
  const formatted = { role: content.role, parts: [] };
  const pendingDocumentIndices = [];
  const meta = {};
  if (content.usageMetadata?.promptTokenCount != null)
    meta.tokenIn = content.usageMetadata.promptTokenCount;
  if (content.usageMetadata?.candidatesTokenCount != null)
    meta.tokenOut = content.usageMetadata.candidatesTokenCount;
  if (content.durationMs != null)
    meta.durationMs = content.durationMs;
  if (content.streamOutputDurationMs != null)
    meta.streamOutputDurationMs = content.streamOutputDurationMs;
  if (content.modelName)
    meta.modelName = content.modelName;
  if (Object.keys(meta).length > 0)
    formatted.meta = meta;
  for (const part of content.parts) {
    if (isOCRTextPart(part)) {
      continue;
    }
    if (isThoughtTextPart(part)) {
      if (part.text?.trim()) {
        formatted.parts.push({ type: "thought", text: part.text, durationMs: part.thoughtDurationMs });
      }
      continue;
    }
    if (isTextPart(part)) {
      if (isImageDimensionNote(part.text))
        continue;
      const fileName = extractDocumentMarkerFileName(part.text);
      if (fileName && pendingDocumentIndices.length > 0) {
        const targetIndex = pendingDocumentIndices.shift();
        if (typeof targetIndex === "number" && formatted.parts[targetIndex]?.type === "document") {
          formatted.parts[targetIndex].fileName = fileName;
        }
      } else if (fileName) {
        const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
        const mimeMap = {
          json: "application/json",
          txt: "text/plain",
          csv: "text/csv",
          xml: "application/xml",
          md: "text/markdown",
          yaml: "application/x-yaml",
          yml: "application/x-yaml",
          py: "text/x-python",
          js: "application/javascript",
          ts: "application/typescript",
          html: "text/html",
          css: "text/css"
        };
        formatted.parts.push({
          type: "document",
          fileName,
          mimeType: mimeMap[ext] || "text/plain",
          text: part.text?.replace(/^\[Document: [^\]\r\n]+\]\s*/, "") ?? ""
        });
        continue;
      }
      formatted.parts.push({ type: "text", text: part.text });
      continue;
    }
    if (isInlineDataPart(part)) {
      if (isDocumentMimeType(part.inlineData.mimeType)) {
        formatted.parts.push({
          type: "document",
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data
        });
        pendingDocumentIndices.push(formatted.parts.length - 1);
      } else {
        formatted.parts.push({
          type: "image",
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data
        });
      }
      continue;
    }
    if (isFunctionCallPart(part)) {
      formatted.parts.push({
        type: "function_call",
        name: part.functionCall.name,
        args: part.functionCall.args,
        callId: part.functionCall.callId
      });
      continue;
    }
    if (isFunctionResponsePart(part)) {
      formatted.parts.push({
        type: "function_response",
        name: part.functionResponse.name,
        response: part.functionResponse.response,
        callId: part.functionResponse.callId
      });
    }
  }
  return formatted;
}
function formatMessages(contents) {
  return contents.map(formatContent);
}

// src/handlers/sessions.ts
function createSessionsHandlers(storage) {
  return {
    async list(_req, res) {
      const metas = await storage.listSessionMetas();
      const knownIds = new Set(metas.map((meta) => meta.id));
      const orphanIds = (await storage.listSessions()).filter((id) => !knownIds.has(id));
      const sessions = [
        ...metas,
        ...orphanIds.map((id) => ({
          id,
          title: id,
          cwd: "",
          createdAt: "",
          updatedAt: ""
        }))
      ].sort((left, right) => {
        const leftTime = left.updatedAt ? new Date(String(left.updatedAt)).getTime() : 0;
        const rightTime = right.updatedAt ? new Date(String(right.updatedAt)).getTime() : 0;
        return rightTime - leftTime;
      });
      sendJSON(res, 200, { sessions });
    },
    async getMessages(_req, res, params) {
      const history = await storage.getHistory(params.id);
      sendJSON(res, 200, { messages: formatMessages(history) });
    },
    async remove(_req, res, params) {
      await storage.clearHistory(params.id);
      sendJSON(res, 200, { ok: true });
    },
    async truncateMessages(req, res, params) {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const keepCount = parseInt(url.searchParams.get("keepCount") ?? "", 10);
      if (isNaN(keepCount) || keepCount < 0) {
        sendJSON(res, 400, { error: "参数 keepCount 无效" });
        return;
      }
      await storage.truncateHistory(params.id, keepCount);
      sendJSON(res, 200, { ok: true });
    }
  };
}

// src/handlers/config.ts
var SUPPORTED_PROVIDERS = new Set([
  "gemini",
  "openai-compatible",
  "openai-responses",
  "claude"
]);
function isMasked(value) {
  return typeof value === "string" && value.startsWith("****");
}
function resolveStoredModelConfig(rawLLM, modelName) {
  if (rawLLM?.models && typeof rawLLM.models === "object" && !Array.isArray(rawLLM.models)) {
    const requestedModelName = typeof modelName === "string" && modelName.trim() ? modelName.trim() : typeof rawLLM.defaultModel === "string" && rawLLM.defaultModel.trim() ? rawLLM.defaultModel.trim() : undefined;
    if (requestedModelName && rawLLM.models[requestedModelName] && typeof rawLLM.models[requestedModelName] === "object") {
      return rawLLM.models[requestedModelName];
    }
    for (const value of Object.values(rawLLM.models)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
      }
    }
  }
  return {};
}
function resolveModelLookupInput(cm, body) {
  const requestedModelName = typeof body?.modelName === "string" && body.modelName.trim() ? body.modelName.trim() : undefined;
  const rawConfig = cm.readEditableConfig();
  const rawLLM = rawConfig.llm ?? {};
  const storedModel = resolveStoredModelConfig(rawLLM, requestedModelName);
  const providerValue = typeof body?.provider === "string" && body.provider.trim() ? body.provider.trim() : String(storedModel?.provider ?? "gemini").trim();
  if (!SUPPORTED_PROVIDERS.has(providerValue)) {
    throw new Error(`不支持的提供商: ${providerValue || "(空)"}`);
  }
  const baseUrl = typeof body?.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : String(storedModel?.baseUrl ?? "").trim();
  const requestApiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const usedStoredApiKey = !requestApiKey || isMasked(requestApiKey);
  const apiKey = usedStoredApiKey ? String(storedModel?.apiKey ?? "").trim() : requestApiKey;
  if (!apiKey) {
    throw new Error("请先填写 API Key，或先保存配置后再拉取模型列表");
  }
  return {
    provider: providerValue,
    apiKey,
    baseUrl,
    usedStoredApiKey
  };
}
function createConfigHandlers(api, onReload) {
  const cm = api.configManager;
  return {
    async get(_req, res) {
      try {
        sendJSON(res, 200, cm.readEditableConfig());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `读取配置失败: ${msg}` });
      }
    },
    async update(req, res) {
      try {
        const updates = await readBody(req);
        const { mergedRaw } = cm.updateEditableConfig(updates);
        let reloaded = false;
        if (onReload) {
          try {
            await onReload(mergedRaw);
            reloaded = true;
          } catch {}
        }
        sendJSON(res, 200, { ok: true, restartRequired: !reloaded });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `更新配置失败: ${msg}` });
      }
    },
    async listModels(req, res) {
      try {
        const body = await readBody(req);
        const input = resolveModelLookupInput(cm, body);
        if (!api.fetchAvailableModels) {
          sendJSON(res, 501, { error: "模型列表拉取未实现" });
          return;
        }
        const result = await api.fetchAvailableModels(input);
        sendJSON(res, 200, {
          provider: result.provider,
          baseUrl: result.baseUrl,
          usedStoredApiKey: input.usedStoredApiKey,
          models: result.models
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `拉取模型列表失败: ${msg}` });
      }
    }
  };
}

// src/handlers/diff-preview.ts
import * as fs3 from "fs";
import * as path3 from "path";
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, `
`).replace(/\r/g, `
`);
}
function sanitizePatchText(patch) {
  const lines = normalizeLineEndings(patch).split(`
`);
  const out = [];
  for (const line of lines) {
    if (line.startsWith("```"))
      continue;
    if (line === "***" || line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch") || line.startsWith("*** Update File:") || line.startsWith("*** Add File:") || line.startsWith("*** Delete File:") || line.startsWith("*** End of File"))
      continue;
    out.push(line);
  }
  return out.join(`
`).trim();
}
function getSafePatch(value) {
  if (typeof value === "string")
    return value;
  if (value == null)
    return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function toDiffLinePrefix(type) {
  if (type === "add")
    return "+";
  if (type === "del")
    return "-";
  return " ";
}
function toWholeFileDiffLines(text) {
  if (!text)
    return [];
  const lines = normalizeLineEndings(text).split(`
`);
  if (lines.length > 0 && lines[lines.length - 1] === "")
    lines.pop();
  return lines;
}
function buildWholeFileDiff(filePath, before, after, existed) {
  if (before === after)
    return "";
  const beforeLines = toWholeFileDiffLines(before);
  const afterLines = toWholeFileDiffLines(after);
  const bodyLines = [
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ];
  if (bodyLines.length === 0)
    return "";
  const oldFile = existed ? `a/${filePath}` : "/dev/null";
  return [
    `--- ${oldFile}`,
    `+++ b/${filePath}`,
    `@@ -${beforeLines.length > 0 ? 1 : 0},${beforeLines.length} +${afterLines.length > 0 ? 1 : 0},${afterLines.length} @@`,
    ...bodyLines
  ].join(`
`);
}
function countDiffStats(diff) {
  let added = 0, removed = 0;
  for (const line of diff.split(`
`)) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@"))
      continue;
    if (line.startsWith("+"))
      added++;
    else if (line.startsWith("-"))
      removed++;
  }
  return { added, removed };
}
function normalizePositiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : fallback;
}
function makeItem(filePath, label, diff) {
  const { added, removed } = countDiffStats(diff);
  return { filePath, label, diff, added, removed };
}
function makeMsg(filePath, label, message) {
  return { filePath, label, added: 0, removed: 0, message };
}
function buildApplyDiffPreview(inv, utils) {
  const filePath = typeof inv.args.path === "string" ? inv.args.path : "";
  const rawPatch = getSafePatch(inv.args.patch);
  const cleaned = sanitizePatchText(rawPatch);
  let diff = "";
  if (cleaned) {
    try {
      const parsed = utils.parseUnifiedDiff(cleaned);
      const fallbackOld = `a/${filePath || "file"}`;
      const fallbackNew = `b/${filePath || "file"}`;
      const body = parsed.hunks.map((hunk) => {
        const lines = hunk.lines.map((line) => `${toDiffLinePrefix(line.type)}${line.content}`);
        const oldCount = hunk.lines.filter((l) => l.type === "context" || l.type === "del").length;
        const newCount = hunk.lines.filter((l) => l.type === "context" || l.type === "add").length;
        const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
        return [header, ...lines].join(`
`);
      }).join(`
`);
      diff = [`--- ${parsed.oldFile ?? fallbackOld}`, `+++ ${parsed.newFile ?? fallbackNew}`, body].filter(Boolean).join(`
`);
    } catch {
      if (/^(diff --git |--- |\+\+\+ )/m.test(cleaned))
        diff = cleaned;
      else if (/^@@/m.test(cleaned)) {
        const p = filePath || "file";
        diff = `--- a/${p}
+++ b/${p}
${cleaned}`;
      } else
        diff = cleaned;
    }
  }
  return {
    toolName: "apply_diff",
    title: "Diff 审批",
    summary: [filePath ? `目标文件：${filePath}` : "目标文件：未提供"],
    items: [diff ? makeItem(filePath, filePath || "补丁预览", diff) : makeMsg(filePath, filePath || "补丁预览", "补丁为空。")]
  };
}
function buildWriteFilePreview(inv, utils) {
  const fileList = utils.normalizeWriteArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return { toolName: "write_file", title: "Diff 审批", summary: ["参数无效。"], items: [makeMsg("", "write_file", "files 参数无效。")] };
  }
  const items = [];
  let created = 0, modified = 0, unchanged = 0;
  for (const entry of fileList) {
    try {
      const resolved = utils.resolveProjectPath(entry.path);
      let existed = false, before = "";
      if (fs3.existsSync(resolved)) {
        before = fs3.readFileSync(resolved, "utf-8");
        existed = true;
      }
      if (existed && before === entry.content) {
        unchanged++;
        continue;
      }
      const diff = buildWholeFileDiff(entry.path, before, entry.content, existed);
      const action = existed ? "修改" : "新增";
      items.push(diff ? makeItem(entry.path, `${entry.path} · ${action}`, diff) : makeMsg(entry.path, `${entry.path} · ${action}`, existed ? "无法显示 diff。" : "将创建空文件。"));
      if (existed)
        modified++;
      else
        created++;
    } catch (err) {
      items.push(makeMsg(entry.path, `${entry.path} · 错误`, err instanceof Error ? err.message : String(err)));
    }
  }
  const summary = [`共 ${fileList.length} 个文件`, `新增 ${created}，修改 ${modified}，未变化 ${unchanged}`];
  if (items.length === 0)
    items.push(makeMsg("", "write_file", "不会产生实际变更。"));
  return { toolName: "write_file", title: "Diff 审批", summary, items };
}
function buildInsertCodePreview(inv, utils) {
  const fileList = utils.normalizeInsertArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return { toolName: "insert_code", title: "Diff 审批", summary: ["参数无效。"], items: [makeMsg("", "insert_code", "files 参数无效。")] };
  }
  const items = [];
  for (const entry of fileList) {
    try {
      const resolved = utils.resolveProjectPath(entry.path);
      const before = fs3.readFileSync(resolved, "utf-8");
      const lines = before.split(`
`);
      const insertLines = entry.content.split(`
`);
      const idx = entry.line - 1;
      const after = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join(`
`);
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? makeItem(entry.path, `${entry.path} · 第 ${entry.line} 行前插入`, diff) : makeMsg(entry.path, entry.path, "无法显示 diff。"));
    } catch (err) {
      items.push(makeMsg(entry.path, `${entry.path} · 错误`, err instanceof Error ? err.message : String(err)));
    }
  }
  if (items.length === 0)
    items.push(makeMsg("", "insert_code", "无可预览的变更。"));
  return { toolName: "insert_code", title: "Diff 审批", summary: [`共 ${fileList.length} 个操作`], items };
}
function buildDeleteCodePreview(inv, utils) {
  const fileList = utils.normalizeDeleteCodeArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return { toolName: "delete_code", title: "Diff 审批", summary: ["参数无效。"], items: [makeMsg("", "delete_code", "files 参数无效。")] };
  }
  const items = [];
  for (const entry of fileList) {
    try {
      const resolved = utils.resolveProjectPath(entry.path);
      const before = fs3.readFileSync(resolved, "utf-8");
      const lines = before.split(`
`);
      const after = [...lines.slice(0, entry.start_line - 1), ...lines.slice(entry.end_line)].join(`
`);
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? makeItem(entry.path, `${entry.path} · 删除 L${entry.start_line}-${entry.end_line}`, diff) : makeMsg(entry.path, entry.path, "无法显示 diff。"));
    } catch (err) {
      items.push(makeMsg(entry.path, `${entry.path} · 错误`, err instanceof Error ? err.message : String(err)));
    }
  }
  if (items.length === 0)
    items.push(makeMsg("", "delete_code", "无可预览的变更。"));
  return { toolName: "delete_code", title: "Diff 审批", summary: [`共 ${fileList.length} 个操作`], items };
}
function buildSearchReplacePreview(inv, utils) {
  const inputPath = typeof inv.args.path === "string" ? inv.args.path : ".";
  const pattern = typeof inv.args.pattern === "string" ? inv.args.pattern : "**/*";
  const isRegex = inv.args.isRegex === true;
  const query = String(inv.args.query ?? "");
  const replace = inv.args.replace;
  const maxFiles = normalizePositiveInteger(inv.args.maxFiles, 50);
  const maxFileSizeBytes = normalizePositiveInteger(inv.args.maxFileSizeBytes, 2 * 1024 * 1024);
  if (typeof replace !== "string") {
    return { toolName: "search_in_files", title: "Diff 审批", summary: ["缺少 replace 参数。"], items: [makeMsg(inputPath, "search_in_files", "缺少 replace 参数。")] };
  }
  try {
    const regex = utils.buildSearchRegex(query, isRegex);
    const rootAbs = utils.resolveProjectPath(inputPath);
    const stat = fs3.statSync(rootAbs);
    const patternRe = utils.globToRegExp(pattern);
    const items = [];
    let processedFiles = 0, totalReplacements = 0;
    const shouldStop = () => processedFiles >= maxFiles;
    const processFile = (fileAbs, relPosix) => {
      if (shouldStop())
        return;
      if (stat.isDirectory() && !patternRe.test(relPosix))
        return;
      processedFiles++;
      const displayPath = stat.isDirectory() ? utils.toPosix(path3.join(inputPath, relPosix)) : utils.toPosix(inputPath);
      const buf = fs3.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes || utils.isLikelyBinary(buf))
        return;
      const decoded = utils.decodeText(buf);
      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      if (newText === decoded.text)
        return;
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
      const diff = buildWholeFileDiff(displayPath, decoded.text, newText, true);
      if (diff) {
        items.push(makeItem(displayPath, `${displayPath} · ${replacements} 处替换`, diff));
        totalReplacements += replacements;
      }
    };
    if (stat.isFile())
      processFile(rootAbs, utils.toPosix(path3.basename(rootAbs)));
    else
      utils.walkFiles(rootAbs, processFile, shouldStop);
    const summary = [`路径 ${inputPath}`, `共 ${totalReplacements} 处替换，${items.length} 个文件变更`];
    if (items.length === 0)
      items.push(makeMsg(inputPath, "search_in_files", "不会修改任何文件。"));
    return { toolName: "search_in_files", title: "Diff 审批", summary, items };
  } catch (err) {
    return { toolName: "search_in_files", title: "Diff 审批", summary: ["生成预览失败。"], items: [makeMsg(inputPath, "search_in_files", err instanceof Error ? err.message : String(err))] };
  }
}
function buildPreview2(inv, utils) {
  switch (inv.toolName) {
    case "apply_diff":
      return buildApplyDiffPreview(inv, utils);
    case "write_file":
      return buildWriteFilePreview(inv, utils);
    case "insert_code":
      return buildInsertCodePreview(inv, utils);
    case "delete_code":
      return buildDeleteCodePreview(inv, utils);
    case "search_in_files":
      if ((inv.args.mode ?? "search") === "replace") {
        return buildSearchReplacePreview(inv, utils);
      }
      break;
  }
  return { toolName: inv.toolName, title: "Diff 审批", summary: ["此工具不支持 diff 预览。"], items: [makeMsg("", inv.toolName, "此工具不支持 diff 预览。")] };
}
function createDiffPreviewHandler(backend, utils) {
  return async (_req, res, params) => {
    const toolId = params.id;
    if (!toolId) {
      sendJSON(res, 400, { error: "缺少工具 ID" });
      return;
    }
    const inv = backend.getToolState?.()?.get?.(toolId);
    if (!inv) {
      sendJSON(res, 404, { error: "未找到工具调用" });
      return;
    }
    try {
      const preview = buildPreview2(inv, utils);
      sendJSON(res, 200, preview);
    } catch (err) {
      sendJSON(res, 500, { error: err instanceof Error ? err.message : "生成 diff 预览失败" });
    }
  };
}

// src/handlers/extensions.ts
var import_yaml = __toESM(require_dist(), 1);
import * as fs6 from "fs";
import * as path9 from "path";

// ../../packages/extension-sdk/src/utils/types.ts
var DISABLED_MARKER_FILE = ".disabled";
// ../../packages/extension-sdk/src/utils/paths.ts
import * as path4 from "node:path";
function normalizeText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function normalizeRelativeFilePath(input, label = "文件路径") {
  const normalized = input.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) {
    throw new Error(`${label}不能为空`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label}无效: ${input}`);
  }
  return parts.join("/");
}
function normalizeRequestedExtensionPath(requested, label) {
  const trimmed = requested.trim();
  if (!trimmed) {
    throw new Error(`${label}不能为空`);
  }
  let normalized = trimmed.replace(/\\/g, "/").trim();
  normalized = normalized.replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized === "extensions" || normalized === "extensions/") {
    throw new Error(`${label}不能为空`);
  }
  if (normalized.startsWith("extensions/")) {
    normalized = normalized.slice("extensions/".length);
  }
  return normalizeRelativeFilePath(normalized, label);
}
function resolveSafeRelativePath(rootDir, relativePath) {
  const normalizedRoot = path4.resolve(rootDir);
  const resolvedPath = path4.resolve(normalizedRoot, relativePath);
  const rel = path4.relative(normalizedRoot, resolvedPath);
  if (rel.startsWith("..") || path4.isAbsolute(rel)) {
    throw new Error(`路径越界: ${relativePath}`);
  }
  return resolvedPath;
}
function encodeRepoPathForUrl(repoPath) {
  return repoPath.split("/").map((part) => encodeURIComponent(part)).join("/");
}
// ../../packages/extension-sdk/src/utils/manifest.ts
import * as fs4 from "node:fs";
import * as path5 from "node:path";
var MANIFEST_FILE = "manifest.json";
function parseExtensionManifest(raw, sourceLabel) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`extension manifest 格式无效，应为对象: ${sourceLabel}`);
  }
  const manifest = raw;
  if (!normalizeText(manifest.name)) {
    throw new Error(`extension manifest 缺少 name: ${sourceLabel}`);
  }
  if (!normalizeText(manifest.version)) {
    throw new Error(`extension manifest 缺少 version: ${sourceLabel}`);
  }
  return manifest;
}
function readManifestFromDir(rootDir) {
  const manifestPath = path5.join(rootDir, MANIFEST_FILE);
  if (!fs4.existsSync(manifestPath))
    return;
  try {
    const raw = JSON.parse(fs4.readFileSync(manifestPath, "utf-8"));
    return parseExtensionManifest(raw, manifestPath);
  } catch {
    return;
  }
}
// ../../packages/extension-sdk/src/utils/fs-utils.ts
import * as fs5 from "node:fs";
import * as path6 from "node:path";
function ensureDirectory(dirPath) {
  fs5.mkdirSync(dirPath, { recursive: true });
}
function createTempInstallDir(installedRootDir) {
  ensureDirectory(installedRootDir);
  const tempDir = path6.join(installedRootDir, `.tmp-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs5.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}
function cleanupTempInstallDir(tempDir) {
  if (fs5.existsSync(tempDir)) {
    fs5.rmSync(tempDir, { recursive: true, force: true });
  }
}
function collectRelativeFilesFromDir(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    for (const entry of fs5.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path6.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      files.push(path6.relative(rootDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return files;
}
// ../../packages/extension-sdk/src/utils/runtime-paths.ts
import * as os2 from "node:os";
import * as path7 from "node:path";
function resolveRuntimeDataDir() {
  return path7.resolve(process.env.IRIS_DATA_DIR || path7.join(os2.homedir(), ".iris"));
}
function resolveRuntimeConfigDir() {
  return path7.join(resolveRuntimeDataDir(), "configs");
}
function getInstalledExtensionsDir() {
  return path7.join(resolveRuntimeDataDir(), "extensions");
}
// ../../packages/extension-sdk/src/utils/remote.ts
var DEFAULT_REMOTE_EXTENSION_INDEX_URL = "https://raw.githubusercontent.com/Lianues/Iris/main/extensions/index.json";
var DEFAULT_REMOTE_EXTENSION_RAW_BASE_URL = "https://raw.githubusercontent.com/Lianues/Iris/main";
var DEFAULT_REMOTE_EXTENSIONS_SUBDIR = "extensions";
var DEFAULT_REMOTE_EXTENSION_REQUEST_TIMEOUT_MS = 15000;
function getRemoteExtensionRequestTimeoutMs() {
  const raw = Number(process.env.IRIS_EXTENSION_REMOTE_TIMEOUT_MS?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REMOTE_EXTENSION_REQUEST_TIMEOUT_MS;
}
function getRemoteExtensionIndexUrl(options) {
  const configured = options?.remoteIndexUrl?.trim() || process.env.IRIS_EXTENSION_REMOTE_INDEX_URL?.trim();
  return configured || DEFAULT_REMOTE_EXTENSION_INDEX_URL;
}
function getRemoteRawBaseUrl(options) {
  const configured = options?.remoteRawBaseUrl?.trim() || process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL?.trim();
  return configured || DEFAULT_REMOTE_EXTENSION_RAW_BASE_URL;
}
function getRemoteExtensionsSubdir(options) {
  const configured = options?.remoteExtensionsSubdir?.trim() || process.env.IRIS_EXTENSION_REMOTE_SUBDIR?.trim();
  return normalizeRelativeFilePath(configured || DEFAULT_REMOTE_EXTENSIONS_SUBDIR, "远程 extension 根目录");
}
async function fetchWithTimeout(url, label) {
  const timeoutMs = getRemoteExtensionRequestTimeoutMs();
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? `${label} 请求超时（${timeoutMs}ms）: ${url}` : `${label} 请求失败: ${error instanceof Error ? error.message : String(error)}: ${url}`;
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}
async function fetchBuffer(url, label) {
  const response = await fetchWithTimeout(url, label);
  if (!response.ok) {
    throw new Error(`${label} 下载失败 (${response.status} ${response.statusText}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
async function fetchJson(url, label) {
  const response = await fetchWithTimeout(url, label);
  if (!response.ok) {
    throw new Error(`${label} 读取失败 (${response.status} ${response.statusText}): ${url}`);
  }
  return await response.json();
}
async function fetchRemoteIndex(options) {
  const raw = await fetchJson(getRemoteExtensionIndexUrl(options), "远程 extension 索引");
  if (!Array.isArray(raw.extensions)) {
    throw new Error("远程 extension 索引返回格式无效");
  }
  return raw.extensions.map((entry) => normalizeRequestedExtensionPath(String(entry), "远程 extension 路径"));
}
function buildRemoteExtensionPath(requested, options) {
  return `${getRemoteExtensionsSubdir(options)}/${requested}`;
}
function getRemoteDistributionFiles(manifest) {
  return Array.isArray(manifest.distribution?.files) ? manifest.distribution.files.map((file) => normalizeRelativeFilePath(String(file), "远程 extension 文件路径")) : [];
}
function buildRemoteExtensionFileUrl(requestedPath, relativePath, options) {
  const repoPath = `${buildRemoteExtensionPath(requestedPath, options)}/${relativePath}`;
  return `${getRemoteRawBaseUrl(options)}/${encodeRepoPathForUrl(repoPath)}`;
}
async function fetchRemoteManifest(requestedPath, options) {
  const manifestUrl = buildRemoteExtensionFileUrl(requestedPath, MANIFEST_FILE, options);
  const raw = await fetchJson(manifestUrl, "extension manifest");
  return parseExtensionManifest(raw, `${buildRemoteExtensionPath(requestedPath, options)}/${MANIFEST_FILE}`);
}
// ../../packages/extension-sdk/src/utils/runtime-analysis.ts
import * as path8 from "node:path";
var SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
var RUNTIME_FILE_EXTENSIONS = new Set([".mjs", ".js", ".cjs"]);
function collectRuntimeEntryGroups(manifest) {
  const groups = [];
  const pluginEntry = normalizeText(manifest.plugin?.entry) ?? normalizeText(manifest.entry);
  const hasPlatforms = Array.isArray(manifest.platforms) && manifest.platforms.length > 0;
  if (pluginEntry) {
    groups.push({ label: "plugin", alternatives: [pluginEntry] });
  } else if (!hasPlatforms) {
    groups.push({
      label: "plugin",
      alternatives: ["index.mjs", "index.js", "index.cjs", "index.ts"]
    });
  }
  for (const platform of manifest.platforms ?? []) {
    const name = normalizeText(platform?.name);
    const entry = normalizeText(platform?.entry);
    if (!name || !entry)
      continue;
    groups.push({ label: `platform:${name}`, alternatives: [entry] });
  }
  return groups;
}
function analyzeRuntimeEntries(availableFiles, manifest) {
  const normalizedFiles = new Set(availableFiles.map((file) => file.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")));
  return collectRuntimeEntryGroups(manifest).map((group) => {
    const existingAlternatives = group.alternatives.filter((relativePath) => normalizedFiles.has(relativePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")));
    const runnableAlternatives = existingAlternatives.filter((relativePath) => RUNTIME_FILE_EXTENSIONS.has(path8.extname(relativePath).toLowerCase()));
    const sourceAlternatives = existingAlternatives.filter((relativePath) => {
      const ext = path8.extname(relativePath).toLowerCase();
      return SOURCE_FILE_EXTENSIONS.has(ext) || /(^|[\\/])src([\\/]|$)/.test(relativePath);
    });
    const needsBuild = runnableAlternatives.length === 0 || sourceAlternatives.length > 0;
    return {
      label: group.label,
      alternatives: group.alternatives,
      existingAlternatives,
      runnableAlternatives,
      sourceAlternatives,
      needsBuild
    };
  });
}
function describeRuntimeIssues(analyses) {
  return analyses.filter((item) => item.needsBuild).map((item) => {
    if (item.sourceAlternatives.length > 0) {
      return `${item.label} 使用了源码入口: ${item.sourceAlternatives.join(", ")}`;
    }
    if (item.existingAlternatives.length > 0) {
      return `${item.label} 缺少可运行入口，当前存在: ${item.existingAlternatives.join(", ")}`;
    }
    return `${item.label} 缺少入口文件，期望其一: ${item.alternatives.join(", ")}`;
  }).join("；");
}
// src/handlers/extensions.ts
function getEmbeddedExtensionsDir(installDir) {
  return path9.join(path9.resolve(installDir), "extensions");
}
function getPlatformCount(manifest) {
  return Array.isArray(manifest.platforms) ? manifest.platforms.filter((p) => !!normalizeText(p?.name) && !!normalizeText(p?.entry)).length : 0;
}
function hasPlatformContribution(manifest) {
  return getPlatformCount(manifest) > 0;
}
function hasPluginContribution(manifest) {
  if (manifest.plugin && typeof manifest.plugin === "object")
    return true;
  if (normalizeText(manifest.entry))
    return true;
  return !hasPlatformContribution(manifest);
}
function buildTypeLabel(manifest) {
  const hasPlugin = hasPluginContribution(manifest);
  const pc = getPlatformCount(manifest);
  if (hasPlugin && pc > 0)
    return "插件 + 平台";
  if (hasPlugin)
    return "插件";
  if (pc > 1)
    return `${pc} 个平台`;
  if (pc === 1)
    return "平台";
  return "扩展";
}
function analyzeDistribution(files, manifest) {
  const analyses = analyzeRuntimeEntries(files, manifest);
  const issues = analyses.filter((a) => a.needsBuild);
  if (issues.length > 0) {
    return { distributionMode: "source", distributionLabel: "源码包", runnableEntries: [] };
  }
  return {
    distributionMode: "bundled",
    distributionLabel: "可直接安装",
    runnableEntries: analyses.flatMap((a) => a.runnableAlternatives)
  };
}
function readEditablePluginEntries() {
  const pluginsPath = path9.join(resolveRuntimeConfigDir(), "plugins.yaml");
  if (!fs6.existsSync(pluginsPath))
    return [];
  try {
    const raw = import_yaml.parse(fs6.readFileSync(pluginsPath, "utf-8"));
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.plugins) ? raw.plugins : [];
    return list.filter((item) => !!item && typeof item === "object").filter((item) => !!normalizeText(item.name)).map((item) => ({
      name: normalizeText(item.name),
      type: item.type === "npm" ? "npm" : "local",
      enabled: item.enabled !== false,
      priority: typeof item.priority === "number" ? item.priority : undefined,
      config: item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : undefined
    }));
  } catch {
    return [];
  }
}
function writeEditablePluginEntries(entries) {
  const configDir = resolveRuntimeConfigDir();
  const pluginsPath = path9.join(configDir, "plugins.yaml");
  ensureDirectory(configDir);
  fs6.writeFileSync(pluginsPath, `# 插件配置

${import_yaml.stringify({ plugins: entries }, { indent: 2 })}`, "utf-8");
}
function upsertLocalPluginEnabled(name, enabled) {
  const entries = readEditablePluginEntries();
  const idx = entries.findIndex((e) => e.name === name && (e.type ?? "local") === "local");
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], type: "local", enabled };
  } else {
    entries.push({ name, type: "local", enabled });
  }
  writeEditablePluginEntries(entries);
}
function removeLocalPluginEntry(name) {
  writeEditablePluginEntries(readEditablePluginEntries().filter((e) => !(e.name === name && (e.type ?? "local") === "local")));
}
function getPluginEnabledState(name) {
  const entry = readEditablePluginEntries().find((e) => e.name === name && (e.type ?? "local") === "local");
  if (!entry)
    return;
  return entry.enabled !== false;
}
function hasDisabledMarker(rootDir) {
  return fs6.existsSync(path9.join(rootDir, DISABLED_MARKER_FILE));
}
function setDisabledMarker(rootDir, disabled) {
  const markerPath = path9.join(rootDir, DISABLED_MARKER_FILE);
  if (disabled) {
    fs6.writeFileSync(markerPath, `disabled
`, "utf-8");
  } else if (fs6.existsSync(markerPath)) {
    fs6.rmSync(markerPath, { force: true });
  }
}
function resolveInstalledState(manifest, rootDir) {
  if (hasDisabledMarker(rootDir))
    return { enabled: false, stateLabel: "已关闭" };
  const hasPlugin = hasPluginContribution(manifest);
  const hasPlatforms = hasPlatformContribution(manifest);
  if (hasPlugin) {
    const pluginEnabled = getPluginEnabledState(manifest.name);
    if (pluginEnabled === false || pluginEnabled == null) {
      return { enabled: hasPlatforms, stateLabel: hasPlatforms ? "平台已启用，插件未启用" : "未启用" };
    }
  }
  return { enabled: true, stateLabel: "已开启" };
}
function buildDTO(manifest, opts = {}) {
  const dist = opts.distributionMode ? { distributionMode: opts.distributionMode, distributionLabel: opts.distributionLabel ?? "" } : { distributionMode: "source", distributionLabel: "源码包" };
  return {
    name: manifest.name,
    version: manifest.version,
    description: normalizeText(manifest.description) ?? "无描述",
    typeLabel: buildTypeLabel(manifest),
    hasPlugin: hasPluginContribution(manifest),
    hasPlatforms: hasPlatformContribution(manifest),
    platformCount: getPlatformCount(manifest),
    installed: false,
    enabled: false,
    stateLabel: "未安装",
    ...dist,
    ...opts
  };
}
function loadInstalledExtensions() {
  const rootDir = getInstalledExtensionsDir();
  if (!fs6.existsSync(rootDir) || !fs6.statSync(rootDir).isDirectory())
    return [];
  const results = [];
  for (const entry of fs6.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory())
      continue;
    const extDir = path9.join(rootDir, entry.name);
    const manifest = readManifestFromDir(extDir);
    if (!manifest)
      continue;
    const dist = analyzeDistribution(collectRelativeFilesFromDir(extDir), manifest);
    const state = resolveInstalledState(manifest, extDir);
    results.push(buildDTO(manifest, {
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      localSource: "installed",
      localVersion: manifest.version,
      distributionMode: dist.distributionMode,
      distributionLabel: dist.distributionLabel
    }));
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
function loadEmbeddedExtensions(installDir) {
  const embeddedRoot = getEmbeddedExtensionsDir(installDir);
  const configPath = path9.join(embeddedRoot, "embedded.json");
  if (!fs6.existsSync(configPath))
    return [];
  try {
    const raw = JSON.parse(fs6.readFileSync(configPath, "utf-8"));
    const names = Array.isArray(raw.extensions) ? raw.extensions.map((i) => normalizeText(i?.name)).filter((n) => !!n) : [];
    const results = [];
    for (const name of names) {
      const extDir = path9.join(embeddedRoot, name);
      const manifest = readManifestFromDir(extDir);
      if (!manifest)
        continue;
      const dist = analyzeDistribution(collectRelativeFilesFromDir(extDir), manifest);
      results.push(buildDTO(manifest, {
        installed: false,
        enabled: hasPlatformContribution(manifest) || getPluginEnabledState(manifest.name) === true,
        stateLabel: "源码内嵌",
        localSource: "embedded",
        localVersion: manifest.version,
        distributionMode: dist.distributionMode,
        distributionLabel: dist.distributionLabel
      }));
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
var BUILTIN_PLATFORMS = [
  {
    value: "console",
    label: "Console (TUI)",
    desc: "终端交互界面，适合本地开发和 SSH 使用。",
    source: "builtin",
    panelFields: []
  },
  {
    value: "web",
    label: "Web (HTTP + GUI)",
    desc: "浏览器访问，适合服务器部署和远程使用。",
    source: "builtin",
    panelTitle: "平台配置",
    panelDescription: "填写 Web 平台的监听参数。",
    panelFields: [
      {
        key: "port",
        configKey: "port",
        type: "number",
        label: "Web 服务端口",
        description: "Web 服务监听端口。",
        placeholder: "8192",
        example: "8192",
        defaultValue: 8192,
        required: true
      }
    ]
  }
];
function normalizePanelField(field) {
  const key = normalizeText(field.key);
  if (!key)
    return;
  const rawType = field.type;
  const type = rawType === "password" ? "password" : rawType === "number" ? "number" : "string";
  return {
    key,
    configKey: normalizeText(field.configKey) ?? key,
    type,
    label: normalizeText(field.label) ?? key,
    description: normalizeText(field.description),
    placeholder: normalizeText(field.placeholder),
    example: normalizeText(field.example),
    defaultValue: typeof field.defaultValue === "string" || typeof field.defaultValue === "number" ? field.defaultValue : undefined,
    required: field.required === true
  };
}
function collectExtensionPlatforms(installDir) {
  const roots = [
    getInstalledExtensionsDir(),
    getEmbeddedExtensionsDir(installDir)
  ];
  const deduped = new Set;
  const results = [];
  for (const root of roots) {
    if (!fs6.existsSync(root) || !fs6.statSync(root).isDirectory())
      continue;
    const resolvedRoot = path9.resolve(root);
    if (deduped.has(resolvedRoot))
      continue;
    deduped.add(resolvedRoot);
    for (const entry of fs6.readdirSync(resolvedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory())
        continue;
      const extDir = path9.join(resolvedRoot, entry.name);
      const manifestPath = path9.join(extDir, "manifest.json");
      if (!fs6.existsSync(manifestPath))
        continue;
      let manifest;
      try {
        manifest = JSON.parse(fs6.readFileSync(manifestPath, "utf-8"));
        if (!manifest || typeof manifest !== "object")
          continue;
      } catch {
        continue;
      }
      const platforms = manifest.platforms;
      if (!Array.isArray(platforms))
        continue;
      for (const pc of platforms) {
        if (!pc || typeof pc !== "object")
          continue;
        const platformName = normalizeText(pc.name);
        if (!platformName)
          continue;
        const panel = pc.panel;
        const panelFields = Array.isArray(panel?.fields) ? panel.fields.map(normalizePanelField).filter((f) => !!f) : [];
        results.push({
          value: platformName,
          label: normalizeText(pc.label) ?? platformName,
          desc: normalizeText(pc.description) ?? normalizeText(manifest.description) ?? `${platformName} extension`,
          source: "extension",
          panelTitle: normalizeText(panel?.title),
          panelDescription: normalizeText(panel?.description),
          panelFields
        });
      }
    }
  }
  return results;
}
function loadAvailablePlatforms(installDir) {
  const map = new Map;
  for (const b of BUILTIN_PLATFORMS)
    map.set(b.value, b);
  for (const p of collectExtensionPlatforms(installDir)) {
    if (!map.has(p.value))
      map.set(p.value, p);
  }
  const builtins = BUILTIN_PLATFORMS.map((b) => map.get(b.value)).filter(Boolean);
  const exts = Array.from(map.values()).filter((p) => p.source === "extension").sort((a, b) => a.value.localeCompare(b.value));
  return [...builtins, ...exts];
}
function createExtensionHandlers(installDir) {
  return {
    async list(_req, res) {
      try {
        const installed = loadInstalledExtensions();
        const embedded = loadEmbeddedExtensions(installDir);
        const seen = new Set(installed.map((e) => e.name));
        const all = [...installed, ...embedded.filter((e) => !seen.has(e.name))];
        sendJSON(res, 200, { extensions: all });
      } catch (err) {
        sendJSON(res, 500, { error: `加载扩展列表失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
    async remote(_req, res) {
      try {
        const remoteIndex = await fetchRemoteIndex();
        const remoteEntries = (await Promise.allSettled(remoteIndex.map(async (requestedPath) => {
          const manifest = await fetchRemoteManifest(requestedPath);
          return { requestedPath, manifest, files: getRemoteDistributionFiles(manifest) };
        }))).filter((r) => r.status === "fulfilled").map((r) => r.value);
        const installedMap = new Map(loadInstalledExtensions().map((e) => [e.name, e]));
        const embeddedMap = new Map(loadEmbeddedExtensions(installDir).map((e) => [e.name, e]));
        const results = [];
        for (const entry of remoteEntries) {
          const dist = analyzeDistribution(entry.files, entry.manifest);
          const local = installedMap.get(entry.manifest.name) ?? embeddedMap.get(entry.manifest.name);
          results.push(buildDTO(entry.manifest, {
            requestedPath: entry.requestedPath,
            installed: local?.installed ?? false,
            enabled: local?.enabled ?? false,
            stateLabel: local?.stateLabel ?? "未安装",
            localSource: local?.localSource,
            localVersion: local?.localVersion,
            localVersionHint: local?.localVersion ? `本地已有版本 ${local.localVersion}${local.localSource === "installed" ? "（已安装）" : local.localSource === "embedded" ? "（源码内嵌）" : ""}` : undefined,
            distributionMode: dist.distributionMode,
            distributionLabel: dist.distributionLabel
          }));
        }
        sendJSON(res, 200, { extensions: results.sort((a, b) => a.name.localeCompare(b.name)) });
      } catch (err) {
        sendJSON(res, 500, { error: `加载远程扩展列表失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
    async install(req, res) {
      try {
        const body = await readBody(req);
        const requestedPath = typeof body?.requestedPath === "string" ? body.requestedPath.trim() : "";
        if (!requestedPath) {
          sendJSON(res, 400, { error: "缺少 requestedPath 参数" });
          return;
        }
        const requested = normalizeRequestedExtensionPath(requestedPath, "extension 路径");
        const installedRootDir = getInstalledExtensionsDir();
        const tempDir = createTempInstallDir(installedRootDir);
        try {
          const remoteIndex = await fetchRemoteIndex();
          if (!remoteIndex.includes(requested)) {
            cleanupTempInstallDir(tempDir);
            sendJSON(res, 404, { error: `远程 extension 目录不存在: ${requested}` });
            return;
          }
          const manifest = await fetchRemoteManifest(requested);
          const files = getRemoteDistributionFiles(manifest);
          ensureDirectory(tempDir);
          fs6.writeFileSync(path9.join(tempDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}
`, "utf-8");
          for (const relativePath of files) {
            const normalized = normalizeRelativeFilePath(relativePath);
            if (normalized === MANIFEST_FILE)
              continue;
            const dest = resolveSafeRelativePath(tempDir, normalized);
            ensureDirectory(path9.dirname(dest));
            fs6.writeFileSync(dest, await fetchBuffer(buildRemoteExtensionFileUrl(requested, normalized), "extension 文件"));
          }
          const installed = readManifestFromDir(tempDir);
          if (!installed) {
            cleanupTempInstallDir(tempDir);
            sendJSON(res, 500, { error: `安装后 manifest 验证失败` });
            return;
          }
          const dist = analyzeDistribution(collectRelativeFilesFromDir(tempDir), installed);
          if (dist.distributionMode !== "bundled") {
            cleanupTempInstallDir(tempDir);
            sendJSON(res, 400, { error: `这不是可直接安装的发行包：${describeRuntimeIssues(analyzeRuntimeEntries(collectRelativeFilesFromDir(tempDir), installed).filter((a) => a.needsBuild))}` });
            return;
          }
          const targetDir = path9.join(installedRootDir, installed.name);
          fs6.rmSync(targetDir, { recursive: true, force: true });
          fs6.renameSync(tempDir, targetDir);
          sendJSON(res, 200, {
            ok: true,
            extension: buildDTO(installed, {
              installed: true,
              enabled: true,
              stateLabel: "已开启",
              localSource: "installed",
              localVersion: installed.version,
              distributionMode: dist.distributionMode,
              distributionLabel: dist.distributionLabel
            })
          });
        } catch (innerErr) {
          cleanupTempInstallDir(tempDir);
          throw innerErr;
        }
      } catch (err) {
        if (!res.headersSent) {
          sendJSON(res, 500, { error: `安装失败: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    },
    async enable(req, res, params) {
      try {
        const name = params.name;
        const rootDir = path9.join(getInstalledExtensionsDir(), name);
        if (!fs6.existsSync(rootDir)) {
          sendJSON(res, 404, { error: `extension 不存在: ${name}` });
          return;
        }
        setDisabledMarker(rootDir, false);
        const manifest = readManifestFromDir(rootDir);
        if (manifest && hasPluginContribution(manifest)) {
          upsertLocalPluginEnabled(name, true);
        }
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: `启用失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
    async disable(req, res, params) {
      try {
        const name = params.name;
        const rootDir = path9.join(getInstalledExtensionsDir(), name);
        if (!fs6.existsSync(rootDir)) {
          sendJSON(res, 404, { error: `extension 不存在: ${name}` });
          return;
        }
        setDisabledMarker(rootDir, true);
        const manifest = readManifestFromDir(rootDir);
        if (manifest && hasPluginContribution(manifest)) {
          upsertLocalPluginEnabled(name, false);
        }
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: `禁用失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
    async remove(req, res, params) {
      try {
        const name = params.name;
        const rootDir = path9.join(getInstalledExtensionsDir(), name);
        if (!fs6.existsSync(rootDir)) {
          sendJSON(res, 404, { error: `extension 不存在: ${name}` });
          return;
        }
        const manifest = readManifestFromDir(rootDir);
        fs6.rmSync(rootDir, { recursive: true, force: true });
        if (manifest && hasPluginContribution(manifest)) {
          removeLocalPluginEntry(name);
        }
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: `删除失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
    async platforms(_req, res) {
      try {
        sendJSON(res, 200, { platforms: loadAvailablePlatforms(installDir) });
      } catch (err) {
        sendJSON(res, 500, { error: `加载平台列表失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  };
}

// src/security/management.ts
import * as crypto3 from "crypto";
function getPresentedManagementToken(req) {
  const token = req.headers["x-management-token"];
  if (typeof token === "string")
    return token.trim();
  if (Array.isArray(token))
    return token[0]?.trim() || "";
  return "";
}
function safeEqual2(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length)
    return false;
  return crypto3.timingSafeEqual(left, right);
}
function assertManagementToken(req, res, expectedToken) {
  if (!expectedToken)
    return true;
  const presented = getPresentedManagementToken(req);
  if (!presented || !safeEqual2(presented, expectedToken)) {
    sendJSON(res, 401, {
      error: "未授权：缺少或无效的管理令牌",
      code: "MANAGEMENT_TOKEN_INVALID"
    });
    return false;
  }
  return true;
}

// src/handlers/terminal.ts
import * as os3 from "os";
import * as path10 from "path";
import * as fs7 from "fs";
import { execSync } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
var logger = createExtensionLogger("Terminal");
var pty = null;
try {
  pty = await import("node-pty");
} catch {
  logger.warn("node-pty 不可用，终端功能将被禁用");
}
function createTerminalHandler(isCompiledBinary = false, projectRoot = process.cwd()) {
  const sessions = new Map;
  const wss = new WebSocketServer({ noServer: true });
  let nextId = 1;
  wss.on("connection", (ws, req) => {
    if (!pty) {
      ws.close(1011, "node-pty 不可用");
      return;
    }
    const id = `term-${nextId++}`;
    const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const initialCols = Math.max(1, parseInt(reqUrl.searchParams.get("cols") ?? "", 10) || 120);
    const initialRows = Math.max(1, parseInt(reqUrl.searchParams.get("rows") ?? "", 10) || 30);
    const tuiEnv = { ...process.env, IRIS_PLATFORM: "console" };
    let spawnCmd;
    let spawnArgs;
    if (isCompiledBinary) {
      spawnCmd = process.execPath;
      spawnArgs = [];
    } else {
      const entryFile = path10.join(projectRoot, "src", "index.ts");
      let bunPath = null;
      try {
        const whereCmd = os3.platform() === "win32" ? "where bun.exe" : "which bun";
        const resolved = execSync(whereCmd, { encoding: "utf-8", timeout: 5000 }).trim().split(/\r?\n/)[0];
        if (resolved && fs7.existsSync(resolved)) {
          bunPath = resolved;
        }
      } catch {}
      if (!bunPath) {
        const candidates = [
          path10.join(os3.homedir(), ".bun", "bin", os3.platform() === "win32" ? "bun.exe" : "bun")
        ];
        if (os3.platform() === "win32") {
          if (process.env.LOCALAPPDATA)
            candidates.push(path10.join(process.env.LOCALAPPDATA, "bun", "bun.exe"));
          if (process.env.APPDATA)
            candidates.push(path10.join(process.env.APPDATA, "npm", "bun.cmd"));
        }
        for (const c of candidates) {
          if (fs7.existsSync(c)) {
            bunPath = c;
            break;
          }
        }
      }
      if (bunPath) {
        logger.info(`Bun 找到: ${bunPath}`);
        spawnCmd = bunPath;
        spawnArgs = ["run", entryFile];
      } else {
        logger.info("未检测到 Bun 运行时，将在终端内自动安装后启动 TUI。");
        if (os3.platform() === "win32") {
          const bunTarget = path10.join(os3.homedir(), ".bun", "bin", "bun.exe");
          spawnCmd = "powershell.exe";
          spawnArgs = [
            "-NoProfile",
            "-Command",
            `Write-Host '[Iris] 正在安装 Bun 运行时...'; ` + `irm bun.sh/install.ps1 | iex; if(Test-Path '${bunTarget}'){ Write-Host '[Iris] 安装完成，正在启动 TUI...'; & '${bunTarget}' run '${entryFile}' } ` + `else { Write-Host '[Iris] Bun 安装失败。请手动安装: https://bun.sh'; Read-Host '按 Enter 关闭' }`
          ];
        } else {
          spawnCmd = process.env.SHELL || "/bin/bash";
          spawnArgs = [
            "-c",
            `echo '[Iris] 正在安装 Bun 运行时...' && curl -fsSL https://bun.sh/install | bash && echo '[Iris] 安装完成，正在启动 TUI...' && ~/.bun/bin/bun run "${entryFile}" || echo '[Iris] Bun 安装失败，请手动安装: https://bun.sh'`
          ];
        }
      }
    }
    let proc;
    try {
      proc = pty.spawn(spawnCmd, spawnArgs, {
        name: "xterm-256color",
        cols: initialCols,
        rows: initialRows,
        cwd: process.cwd(),
        env: tuiEnv
      });
    } catch (err) {
      logger.error(`PTY 创建失败: ${err}`);
      ws.close(1011, "PTY 创建失败");
      return;
    }
    const session = { id, pty: proc, ws };
    sessions.set(id, session);
    logger.info(`终端会话已创建: ${id} (cmd=${spawnCmd}, pid=${proc.pid})`);
    proc.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
    proc.onExit(({ exitCode }) => {
      logger.info(`终端进程退出: ${id} (code=${exitCode})`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\x00${JSON.stringify({ type: "exit", code: exitCode })}`);
        ws.close(1000, "终端进程已退出");
      }
      sessions.delete(id);
    });
    ws.on("message", (data) => {
      const msg = typeof data === "string" ? data : data.toString("utf8");
      if (msg.startsWith("{")) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
            proc.resize(Math.max(1, parsed.cols), Math.max(1, parsed.rows));
            return;
          }
        } catch {}
      }
      proc.write(msg);
    });
    ws.on("close", () => {
      logger.info(`WebSocket 关闭，终止终端: ${id}`);
      try {
        proc.kill();
      } catch {}
      sessions.delete(id);
    });
    ws.on("error", (err) => {
      logger.error(`WebSocket 错误 (${id}): ${err.message}`);
    });
  });
  return {
    available: pty !== null,
    handleUpgrade(req, socket, head) {
      if (!pty) {
        socket.write(`HTTP/1.1 503 Service Unavailable\r
\r
`);
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    },
    killAll() {
      for (const [id, session] of sessions) {
        logger.info(`关闭终端会话: ${id}`);
        try {
          session.pty.kill();
        } catch {}
        try {
          session.ws.close(1001, "服务器关闭");
        } catch {}
      }
      sessions.clear();
      wss.close();
    }
  };
}

// src/web-platform.ts
var logger2 = createExtensionLogger("WebPlatform");
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm"
};
var MODULE_DIR = path11.dirname(fileURLToPath(import.meta.url));

class WebPlatform extends PlatformAdapter {
  server;
  router;
  config;
  publicDir;
  deps;
  agents = new Map;
  defaultAgentName = "default";
  pendingResponses = new Map;
  deployToken;
  terminalHandler;
  reloadHandler;
  platformReloadHandler;
  multiAgentMode = false;
  backendListenerCleanups = new Map;
  constructor(backend, config, deps = {}) {
    super();
    this.config = config;
    this.deps = deps;
    this.router = new Router;
    this.publicDir = this.resolvePublicDir();
    let _mcpManager;
    this.agents.set("default", {
      name: "default",
      backend,
      config,
      getMCPManager: () => _mcpManager,
      setMCPManager: (mgr) => {
        _mcpManager = mgr;
      },
      dataDir: path11.dirname(config.configPath),
      extensions: undefined
    });
    this.setupRoutes();
    this.deployToken = crypto4.randomBytes(16).toString("hex");
    this.terminalHandler = createTerminalHandler(this.deps.isCompiledBinary, this.deps.projectRoot);
  }
  resolvePublicDir() {
    const root = this.deps.projectRoot ?? process.cwd();
    const candidates = [
      path11.join(root, "web-ui", "dist"),
      path11.join(MODULE_DIR, "web-ui/dist"),
      path11.join(MODULE_DIR, "../web-ui/dist"),
      path11.join(root, "public"),
      path11.join(MODULE_DIR, "public")
    ];
    for (const candidate of candidates) {
      if (fs8.existsSync(candidate))
        return candidate;
    }
    return candidates[0];
  }
  addAgent(name, backend, config, description, getMCPManager, setMCPManager, extensions) {
    if (this.defaultAgentName === "default" && this.agents.has("default") && name !== "default") {
      this.agents.delete("default");
      this.defaultAgentName = name;
    }
    const cfg = config;
    this.agents.set(name, {
      name,
      description,
      backend,
      config: cfg,
      getMCPManager: getMCPManager ?? (() => {
        return;
      }),
      setMCPManager: setMCPManager ?? (() => {}),
      dataDir: cfg.configPath ? path11.dirname(cfg.configPath) : undefined,
      extensions
    });
  }
  setReloadHandler(handler) {
    this.reloadHandler = handler;
  }
  setPlatformReloadHandler(handler) {
    this.platformReloadHandler = handler;
  }
  async reloadAgents() {
    if (!this.reloadHandler) {
      return { added: [], removed: [], kept: [], message: "未注入 reload handler，无法热重载。" };
    }
    const agentManager = this.deps.api?.agentManager;
    if (!agentManager) {
      return { added: [], removed: [], kept: [], message: "agentManager 不可用，无法热重载。" };
    }
    agentManager.resetCache();
    const status = agentManager.getStatus();
    const enabled = status.enabled;
    const newDefs = enabled ? status.agents : [];
    const newNames = new Set(newDefs.map((d) => d.name));
    if (enabled)
      newNames.add("__global__");
    const currentNames = new Set(this.agents.keys());
    const added = [];
    const removed = [];
    const kept = [];
    const unwireAgent = async (name) => {
      const cleanup = this.backendListenerCleanups.get(name);
      if (cleanup) {
        cleanup();
        this.backendListenerCleanups.delete(name);
      }
      const agent = this.agents.get(name);
      if (agent) {
        try {
          const mcp = agent.getMCPManager();
          if (mcp)
            await mcp.disconnectAll();
        } catch {}
      }
    };
    const bootstrapAgent = async (def) => {
      const result = await this.reloadHandler(def);
      const name = def === "__default__" ? "default" : def.name;
      const currentModel = result.router.getCurrentModelInfo();
      let _mcpManager = result.getMCPManager();
      this.agents.set(name, {
        name,
        description: def === "__default__" ? undefined : name === "__global__" ? "全局 AI" : def.description,
        backend: result.backend,
        config: {
          ...this.config,
          provider: currentModel.provider,
          modelId: currentModel.modelId,
          streamEnabled: result.config.system.stream,
          configPath: result.configDir
        },
        getMCPManager: () => _mcpManager,
        dataDir: path11.dirname(result.configDir),
        setMCPManager: (mgr) => {
          _mcpManager = mgr;
        },
        extensions: { llmProviders: result.extensions.llmProviders, ocrProviders: result.extensions.ocrProviders }
      });
      this.wireBackendEvents(result.backend, name);
    };
    if (!enabled) {
      if (!this.agents.has("default") || this.agents.size > 1) {
        for (const name of currentNames) {
          await unwireAgent(name);
        }
        this.agents.clear();
        await bootstrapAgent("__default__");
        this.defaultAgentName = "default";
        this.multiAgentMode = false;
        return { added: [], removed: [...currentNames], kept: [], message: "已切换到单 Agent 模式。" };
      }
      return { added: [], removed: [], kept: ["default"], message: "已处于单 Agent 模式，无需变更。" };
    }
    this.multiAgentMode = true;
    for (const name of currentNames) {
      if (name === "default" || !newNames.has(name)) {
        await unwireAgent(name);
        this.agents.delete(name);
        removed.push(name);
      }
    }
    for (const name of newNames) {
      if (currentNames.has(name) && name !== "default") {
        kept.push(name);
      }
    }
    for (const name of newNames) {
      if (!currentNames.has(name) || currentNames.has("default")) {
        try {
          const def = name === "__global__" ? { name: "__global__" } : newDefs.find((d) => d.name === name);
          if (!def) {
            logger2.warn(`Agent「${name}」在定义列表中未找到，跳过。`);
            continue;
          }
          await bootstrapAgent(def);
          added.push(name);
          if (this.defaultAgentName === "default" || !this.agents.has(this.defaultAgentName)) {
            this.defaultAgentName = name;
          }
        } catch (err) {
          logger2.error(`热重载 Agent「${name}」失败:`, err);
        }
      }
    }
    const msg = `热重载完成：新增 ${added.length}，移除 ${removed.length}，保留 ${kept.length}。`;
    logger2.info(msg);
    return { added, removed, kept, message: msg };
  }
  resolveAgent(req) {
    const agentName = req.headers["x-agent-name"];
    if (typeof agentName === "string" && agentName && this.agents.has(agentName)) {
      return this.agents.get(agentName);
    }
    return this.agents.get(this.defaultAgentName) ?? this.agents.values().next().value;
  }
  getAgentList() {
    if (this.agents.size === 1 && this.agents.has("default"))
      return [];
    return Array.from(this.agents.values()).map((a) => ({ name: a.name, description: a.description }));
  }
  async start() {
    for (const agent of this.agents.values()) {
      this.wireBackendEvents(agent.backend, agent.name);
    }
    return new Promise((resolve6) => {
      this.server = http.createServer(async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Management-Token, X-Deploy-Token, X-Agent-Name");
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        const url = req.url ?? "/";
        const pathname = new URL(url, `http://${req.headers.host ?? "localhost"}`).pathname;
        if (this.config.authToken && url.startsWith("/api/")) {
          const auth = req.headers.authorization ?? "";
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (token !== this.config.authToken) {
            sendJSON(res, 401, {
              error: "未授权：缺少或无效的 API 访问令牌",
              code: "AUTH_TOKEN_INVALID"
            });
            return;
          }
        }
        if (pathname === "/api/config" || pathname.startsWith("/api/config/") || pathname.startsWith("/api/deploy/") || pathname.startsWith("/api/cloudflare/") || pathname.startsWith("/api/extensions/") && req.method !== "GET") {
          if (!assertManagementToken(req, res, this.config.managementToken)) {
            return;
          }
        }
        try {
          const handled = await this.router.handle(req, res);
          if (!handled) {
            if (pathname.startsWith("/api/")) {
              sendJSON(res, 404, { error: "未找到 API 路由" });
            } else {
              await this.serveStatic(req, res);
            }
          }
        } catch (err) {
          logger2.error("请求处理异常:", err);
          if (!res.headersSent) {
            sendJSON(res, 500, { error: "服务器内部错误" });
          }
        }
      });
      this.server.on("upgrade", (req, socket, head) => {
        const upgradeUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (upgradeUrl.pathname === "/ws/terminal") {
          if (this.config.authToken) {
            const token = upgradeUrl.searchParams.get("token") ?? "";
            if (token !== this.config.authToken) {
              socket.write(`HTTP/1.1 401 Unauthorized\r
\r
`);
              socket.destroy();
              return;
            }
          }
          this.terminalHandler.handleUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      });
      this.server.listen(this.config.port, this.config.host, () => {
        logger2.info(`Web GUI 已启动: http://${this.config.host}:${this.config.port}`);
        logger2.info(`部署令牌（一键部署需要）: ${this.deployToken}`);
        if (this.terminalHandler.available) {
          logger2.info("终端 WebSocket 已就绪: /ws/terminal");
        } else {
          logger2.warn("node-pty 不可用，终端功能已禁用");
        }
        resolve6();
      });
    });
  }
  async stop() {
    this.terminalHandler.killAll();
    for (const [, res] of this.pendingResponses) {
      if (!res.writableEnded)
        res.end();
    }
    this.pendingResponses.clear();
    return new Promise((resolve6) => {
      if (this.server) {
        this.server.close(() => resolve6());
      } else {
        resolve6();
      }
    });
  }
  hasPending(sessionId) {
    return this.pendingResponses.has(sessionId);
  }
  registerPending(sessionId, res) {
    this.pendingResponses.set(sessionId, res);
  }
  removePending(sessionId) {
    this.pendingResponses.delete(sessionId);
    this.sseWriteCount.delete(sessionId);
  }
  async dispatchMessage(sessionId, message, images, documents, agentName) {
    const agent = agentName && this.agents.has(agentName) ? this.agents.get(agentName) : this.agents.get(this.defaultAgentName) ?? this.agents.values().next().value;
    await agent.backend.chat(sessionId, message, images, documents, "web");
  }
  setMCPManager(mgr, agentName) {
    const name = agentName ?? this.defaultAgentName;
    const agent = this.agents.get(name);
    if (agent)
      agent.setMCPManager(mgr);
  }
  getMCPManager(agentName) {
    const name = agentName ?? this.defaultAgentName;
    return this.agents.get(name)?.getMCPManager();
  }
  wireBackendEvents(backend, agentName) {
    const onResponse = (sid, text) => {
      this.writeSSE(sid, { type: "message", text });
    };
    const onStreamStart = (sid) => {
      this.writeSSE(sid, { type: "stream_start" });
    };
    const onStreamChunk = (sid, chunk) => {
      this.writeSSE(sid, { type: "delta", text: chunk });
    };
    const onError = (sid, message) => {
      this.writeSSE(sid, { type: "error", message });
    };
    const onAssistantContent = (sid, content) => {
      this.writeSSE(sid, { type: "assistant_content", message: formatContent(content) });
    };
    const onStreamParts = (sid, parts) => {
      for (const part of parts) {
        if (isThoughtTextPart(part) && part.text) {
          this.writeSSE(sid, {
            type: "thought_delta",
            text: part.text,
            durationMs: part.thoughtDurationMs
          });
        }
      }
    };
    const onStreamEnd = (sid) => {
      this.writeSSE(sid, { type: "stream_end" });
    };
    const onDone = (sid, durationMs) => {
      this.writeSSE(sid, { type: "done_meta", durationMs });
    };
    const onToolUpdate = (sid, invocations) => {
      this.writeSSE(sid, { type: "tool_update", invocations });
    };
    const onUsage = (sid, usage) => {
      this.writeSSE(sid, { type: "usage", usage });
    };
    const onRetry = (sid, attempt, maxRetries, error) => {
      this.writeSSE(sid, { type: "retry", attempt, maxRetries, error });
    };
    const onAutoCompact = (sid, summaryText) => {
      this.writeSSE(sid, { type: "auto_compact", summary: summaryText });
    };
    const onUserToken = (sid, tokenCount) => {
      this.writeSSE(sid, { type: "user_token", tokenCount });
    };
    backend.on("response", onResponse);
    backend.on("stream:start", onStreamStart);
    backend.on("stream:chunk", onStreamChunk);
    backend.on("error", onError);
    backend.on("assistant:content", onAssistantContent);
    backend.on("stream:parts", onStreamParts);
    backend.on("stream:end", onStreamEnd);
    backend.on("done", onDone);
    backend.on("tool:update", onToolUpdate);
    backend.on("usage", onUsage);
    backend.on("retry", onRetry);
    backend.on("auto-compact", onAutoCompact);
    backend.on("user:token", onUserToken);
    if (agentName) {
      this.backendListenerCleanups.set(agentName, () => {
        backend.off("response", onResponse);
        backend.off("stream:start", onStreamStart);
        backend.off("stream:chunk", onStreamChunk);
        backend.off("error", onError);
        backend.off("assistant:content", onAssistantContent);
        backend.off("stream:parts", onStreamParts);
        backend.off("stream:end", onStreamEnd);
        backend.off("done", onDone);
        backend.off("tool:update", onToolUpdate);
        backend.off("usage", onUsage);
        backend.off("retry", onRetry);
        backend.off("auto-compact", onAutoCompact);
        backend.off("user:token", onUserToken);
      });
    }
  }
  sseWriteCount = new Map;
  writeSSE(sessionId, data) {
    const res = this.pendingResponses.get(sessionId);
    if (!res || res.writableEnded)
      return;
    const count = (this.sseWriteCount.get(sessionId) ?? 0) + 1;
    this.sseWriteCount.set(sessionId, count);
    const ok = res.write(`data: ${JSON.stringify(data)}

`);
    if (data.type === "delta" && (count <= 3 || count % 20 === 0)) {
      logger2.info(`[SSE #${count}] delta (${data.text?.length ?? 0} chars) write=${ok}`);
    } else if (data.type !== "delta") {
      logger2.info(`[SSE #${count}] ${data.type} write=${ok}`);
    }
  }
  registerRoute(method, path12, handler) {
    this.router.add(method.toUpperCase(), path12, handler);
  }
  setupRoutes() {
    const { configPath } = this.config;
    this.router.get("/api/agents", async (_req, res) => {
      sendJSON(res, 200, { agents: this.getAgentList() });
    });
    this.router.get("/api/agents/status", async (_req, res) => {
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) {
        sendJSON(res, 503, { error: "agentManager 不可用" });
        return;
      }
      sendJSON(res, 200, agentManager.getStatus());
    });
    this.router.post("/api/agents/reload", async (_req, res) => {
      const result = await this.reloadAgents();
      sendJSON(res, 200, result);
    });
    this.router.post("/api/agents/toggle", async (req, res) => {
      const body = await readBody(req);
      if (typeof body.enabled !== "boolean") {
        sendJSON(res, 400, { error: "缺少 enabled 参数" });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) {
        sendJSON(res, 503, { error: "agentManager 不可用" });
        return;
      }
      const result = agentManager.setEnabled(body.enabled);
      if (result.success) {
        const reload = await this.reloadAgents();
        sendJSON(res, 200, { ...result, reload });
      } else {
        sendJSON(res, 500, result);
      }
    });
    this.router.post("/api/agents/init", async (_req, res) => {
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) {
        sendJSON(res, 503, { error: "agentManager 不可用" });
        return;
      }
      const result = agentManager.createManifest();
      sendJSON(res, result.success ? 200 : 500, result);
    });
    this.router.post("/api/agents/create", async (req, res) => {
      const body = await readBody(req);
      if (typeof body.name !== "string" || !body.name.trim()) {
        sendJSON(res, 400, { success: false, message: "缺少 name 参数" });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) {
        sendJSON(res, 503, { error: "agentManager 不可用" });
        return;
      }
      const result = agentManager.create(body.name.trim(), body.description);
      if (result.success) {
        const reload = await this.reloadAgents();
        sendJSON(res, 200, { ...result, reload });
      } else {
        sendJSON(res, 400, result);
      }
    });
    this.router.post("/api/agents/update", async (req, res) => {
      const body = await readBody(req);
      if (typeof body.name !== "string" || !body.name.trim()) {
        sendJSON(res, 400, { success: false, message: "缺少 name 参数" });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) {
        sendJSON(res, 503, { error: "agentManager 不可用" });
        return;
      }
      const result = agentManager.update(body.name.trim(), {
        description: body.description,
        dataDir: body.dataDir
      });
      sendJSON(res, result.success ? 200 : 400, result);
    });
    this.router.post("/api/agents/delete", async (req, res) => {
      const body = await readBody(req);
      if (typeof body.name !== "string" || !body.name.trim()) {
        sendJSON(res, 400, { success: false, message: "缺少 name 参数" });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) {
        sendJSON(res, 503, { error: "agentManager 不可用" });
        return;
      }
      const result = agentManager.delete(body.name.trim());
      if (result.success) {
        const reload = await this.reloadAgents();
        sendJSON(res, 200, { ...result, reload });
      } else {
        sendJSON(res, 400, result);
      }
    });
    this.router.post("/api/chat", createChatHandler(this));
    this.router.get("/api/sessions", async (req, res) => {
      const storage = this.deps.api?.storage;
      if (!storage) {
        sendJSON(res, 503, { error: "storage 不可用" });
        return;
      }
      return createSessionsHandlers(storage).list(req, res);
    });
    this.router.get("/api/sessions/:id/messages", async (req, res, params) => {
      const storage = this.deps.api?.storage;
      if (!storage) {
        sendJSON(res, 503, { error: "storage 不可用" });
        return;
      }
      return createSessionsHandlers(storage).getMessages(req, res, params);
    });
    this.router.delete("/api/sessions/:id/messages", async (req, res, params) => {
      const storage = this.deps.api?.storage;
      if (!storage) {
        sendJSON(res, 503, { error: "storage 不可用" });
        return;
      }
      return createSessionsHandlers(storage).truncateMessages(req, res, params);
    });
    this.router.delete("/api/sessions/:id", async (req, res, params) => {
      const storage = this.deps.api?.storage;
      if (!storage) {
        sendJSON(res, 503, { error: "storage 不可用" });
        return;
      }
      return createSessionsHandlers(storage).remove(req, res, params);
    });
    const deploy = createDeployHandlers(configPath, () => this.deployToken);
    this.router.get("/api/deploy/state", deploy.getState);
    this.router.get("/api/deploy/detect", deploy.detect);
    this.router.post("/api/deploy/preview", deploy.preview);
    this.router.post("/api/deploy/nginx", deploy.deployNginx);
    this.router.post("/api/deploy/service", deploy.deployService);
    this.router.post("/api/deploy/sync-cloudflare", deploy.syncCloudflare);
    const cloudflare = createCloudflareHandlers(configPath);
    this.router.get("/api/cloudflare/status", cloudflare.status);
    this.router.post("/api/cloudflare/setup", cloudflare.setup);
    this.router.get("/api/cloudflare/dns", cloudflare.listDns);
    this.router.post("/api/cloudflare/dns", cloudflare.addDns);
    this.router.delete("/api/cloudflare/dns/:id", cloudflare.removeDns);
    this.router.get("/api/cloudflare/ssl", cloudflare.getSsl);
    this.router.put("/api/cloudflare/ssl", cloudflare.setSsl);
    const extensions = createExtensionHandlers(this.deps.projectRoot ?? process.cwd());
    this.router.get("/api/extensions", extensions.list);
    this.router.get("/api/extensions/remote", extensions.remote);
    this.router.post("/api/extensions/install", extensions.install);
    this.router.post("/api/extensions/:name/enable", extensions.enable);
    this.router.post("/api/extensions/:name/disable", extensions.disable);
    this.router.delete("/api/extensions/:name", extensions.remove);
    this.router.get("/api/platforms", extensions.platforms);
    this.router.get("/api/config", async (req, res) => {
      if (!this.deps.api) {
        sendJSON(res, 503, { error: "API 不可用" });
        return;
      }
      return createConfigHandlers(this.deps.api).get(req, res);
    });
    this.router.put("/api/config", async (req, res) => {
      if (!this.deps.api) {
        sendJSON(res, 503, { error: "API 不可用" });
        return;
      }
      const agent = this.resolveAgent(req);
      const configHandlers = createConfigHandlers(this.deps.api, async (mergedConfig) => {
        const result = await this.deps.api?.configManager?.applyRuntimeConfigReload(mergedConfig);
        if (result && !result.error) {
          const modelInfo = agent.backend.getCurrentModelInfo?.();
          if (modelInfo) {
            agent.config.provider = modelInfo.provider ?? agent.config.provider;
            agent.config.modelId = modelInfo.modelId ?? agent.config.modelId;
          }
          agent.config.streamEnabled = mergedConfig?.system?.stream ?? agent.config.streamEnabled;
        }
        if (this.platformReloadHandler && mergedConfig?.platform) {
          await this.platformReloadHandler(mergedConfig);
        }
      });
      return configHandlers.update(req, res);
    });
    this.router.post("/api/config/models", async (req, res) => {
      if (!this.deps.api) {
        sendJSON(res, 503, { error: "API 不可用" });
        return;
      }
      return createConfigHandlers(this.deps.api).listModels(req, res);
    });
    this.router.post("/api/config/reset", async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        const result = backend.resetConfigToDefaults?.();
        sendJSON(res, result && result.success ? 200 : 500, result ?? { success: false, message: "不支持的操作" });
      } catch (err) {
        sendJSON(res, 500, { success: false, message: err instanceof Error ? err.message : "重置失败" });
      }
    });
    this.router.get("/api/models", async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        sendJSON(res, 200, { models: backend.listModels?.() ?? [] });
      } catch (err) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : "获取模型列表失败" });
      }
    });
    this.router.get("/api/status", async (req, res) => {
      const agent = this.resolveAgent(req);
      const modelInfo = agent.backend.getCurrentModelInfo?.() ?? {};
      const disabledTools = agent.backend.getDisabledTools?.() ?? [];
      const pRoot = this.deps.projectRoot ?? process.cwd();
      sendJSON(res, 200, {
        provider: agent.config.provider,
        model: agent.config.modelId,
        tools: agent.backend.getToolNames?.() ?? [],
        ...disabledTools.length > 0 ? { disabledTools } : {},
        stream: agent.config.streamEnabled,
        authProtected: !!this.config.authToken,
        managementProtected: !!this.config.managementToken,
        platform: "web",
        contextWindow: modelInfo.contextWindow,
        mcpStatus: agent.getMCPManager()?.getServerInfo?.() ?? [],
        runtime: {
          projectRoot: this.deps.projectRoot,
          dataDir: this.deps.dataDir,
          configDir: this.deps.configDir,
          isCompiledBinary: this.deps.isCompiledBinary,
          configSource: fs8.existsSync(path11.join(pRoot, "data/configs.example")) ? "template" : "embedded"
        }
      });
    });
    this.router.get("/api/tools/:id/diff", async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      const utils = this.deps.api?.toolPreviewUtils;
      if (!utils) {
        sendJSON(res, 503, { error: "toolPreviewUtils 不可用" });
        return;
      }
      return createDiffPreviewHandler(backend, utils)(req, res, params);
    });
    this.router.post("/api/tools/:id/approve", async (req, res, params) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        backend.approveTool?.(params.id, body.approved);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : "操作失败" });
      }
    });
    this.router.post("/api/tools/:id/apply", async (req, res, params) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        backend.applyTool?.(params.id, body.applied);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : "操作失败" });
      }
    });
    this.router.post("/api/sessions/:id/undo", async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      const sessionId = params.id;
      if (this.hasPending(sessionId)) {
        sendJSON(res, 409, { error: "当前会话正在生成中，无法撤销" });
        return;
      }
      try {
        const result = await backend.undo?.(sessionId, "last-visible-message");
        if (!result) {
          sendJSON(res, 200, { ok: true, changed: false });
          return;
        }
        const history = await backend.getHistory?.(sessionId) ?? [];
        sendJSON(res, 200, { ok: true, changed: true, messages: formatMessages(history) });
      } catch (err) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : "撤销失败" });
      }
    });
    this.router.post("/api/sessions/:id/redo", async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      const sessionId = params.id;
      if (this.hasPending(sessionId)) {
        sendJSON(res, 409, { error: "当前会话正在生成中，无法重做" });
        return;
      }
      try {
        const result = await backend.redo?.(sessionId);
        if (!result) {
          sendJSON(res, 200, { ok: true, changed: false });
          return;
        }
        const history = await backend.getHistory?.(sessionId) ?? [];
        sendJSON(res, 200, { ok: true, changed: true, messages: formatMessages(history) });
      } catch (err) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : "重做失败" });
      }
    });
    this.router.post("/api/shell", async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        if (!body.command || typeof body.command !== "string") {
          sendJSON(res, 400, { error: "缺少 command 参数" });
          return;
        }
        const result = backend.runCommand?.(body.command);
        sendJSON(res, 200, result ?? { error: "不支持的操作" });
      } catch (err) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : "命令执行失败" });
      }
    });
    this.router.post("/api/compact", async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          sendJSON(res, 400, { error: "缺少 sessionId 参数" });
          return;
        }
        const summary = await backend.summarize?.(sessionId);
        sendJSON(res, 200, { ok: true, summary });
      } catch (err) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : "压缩失败" });
      }
    });
    this.router.post("/api/model/switch", async (req, res) => {
      try {
        const agent = this.resolveAgent(req);
        const body = await readBody(req);
        if (!body.modelName || typeof body.modelName !== "string") {
          sendJSON(res, 400, { error: "缺少 modelName 参数" });
          return;
        }
        const info = agent.backend.switchModel?.(body.modelName, "web");
        if (!info) {
          sendJSON(res, 500, { error: "模型切换不可用" });
          return;
        }
        agent.config.modelId = info.modelId;
        agent.config.provider = info.provider ?? agent.config.provider;
        sendJSON(res, 200, info);
      } catch (err) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : "切换模型失败" });
      }
    });
  }
  async serveStatic(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let pathname = url.pathname;
    if (pathname === "/" || pathname === "")
      pathname = "/index.html";
    const filePath = path11.resolve(this.publicDir, pathname.slice(1));
    const relative4 = path11.relative(this.publicDir, filePath);
    if (relative4.startsWith("..") || path11.isAbsolute(relative4)) {
      sendJSON(res, 403, { error: "禁止访问" });
      return;
    }
    try {
      const stat = await fs8.promises.stat(filePath);
      if (!stat.isFile())
        throw new Error("非文件");
      const ext = path11.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
      fs8.createReadStream(filePath).pipe(res);
    } catch {
      const indexPath = path11.join(this.publicDir, "index.html");
      try {
        const indexStat = await fs8.promises.stat(indexPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": indexStat.size });
        fs8.createReadStream(indexPath).pipe(res);
      } catch {
        sendJSON(res, 404, { error: "未找到资源" });
      }
    }
  }
}

// src/index.ts
var src_default = definePlatformFactory({
  platformName: "web",
  resolveConfig(raw) {
    return {
      port: raw.port ?? 8192,
      host: raw.host ?? "127.0.0.1",
      authToken: raw.authToken,
      managementToken: raw.managementToken,
      lastModel: raw.lastModel
    };
  },
  async create(backend, config, context) {
    const api = context.api;
    const router = context.router;
    const currentModel = router?.getCurrentModelInfo?.() ?? { provider: "unknown", modelId: "unknown" };
    const fullConfig = context.config;
    const webPlatform = new WebPlatform(backend, {
      port: config.port ?? 8192,
      host: config.host ?? "127.0.0.1",
      authToken: config.authToken,
      managementToken: config.managementToken,
      configPath: context.configDir ?? "",
      provider: currentModel.provider,
      modelId: currentModel.modelId,
      streamEnabled: fullConfig?.system?.stream ?? true
    }, {
      api,
      projectRoot: context.projectRoot ?? process.cwd(),
      dataDir: context.dataDir ?? "",
      configDir: context.configDir,
      isCompiledBinary: context.isCompiledBinary ?? false
    });
    const mcpManager = context.getMCPManager?.();
    if (mcpManager)
      webPlatform.setMCPManager(mcpManager);
    return webPlatform;
  }
});
export {
  src_default as default,
  WebPlatform
};
