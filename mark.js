#!/usr/bin/env node

'use strict';

global.__defineGetter__('__LINE__', function () {
  return (new Error()).stack.split('\n')[3].split(':').reverse()[1];
});

// read template and trim
function read(path) {
  return fs.readFileSync(path).toString().trim();
}

// html special chars
function hsp(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// tagged literal of hsp
function h(tag, val) {
  return `${tag[0]}${hsp(val)}${tag[1]}`;
}

// replace ' ' to '+'
function unspace(str) {
  return str.replace(/ /g, '+');
}

// tag を抜き出す
function Tags(text) {
  let tagtext = text.match(/\# ((\[(.+?)\])+)/)[1];
  // tag は必ず書く
  if (tagtext === undefined || tagtext.length === 0) {
    console.error('\x1b[0;31mThere is No TAGS\x1b[0m');
    process.exit(1);
  }

  text = text.replace(' ' + tagtext, '');

  let tags = tagtext.substr(1, tagtext.length - 2).split('][');
  return { tags: tags, text: text };
}

// # Intro の中身を取り出す
function Description(text) {
  let intro = text.match(/## Intro(([\n\r]|.)*?)##/m)[1].trim();
  intro = intro.replace(/(\n|\r)/g, "");
  intro = intro.substring(0, 140)+"...";
  intro = hsp(intro);
  return intro;
}

// tag ごとのビルダ
class Simple {
  constructor(canonical, amp, indent, template, meta, tags, description, style) {
    this.canonical = canonical;
    this.amp = amp;
    this.indent = indent;
    this.template = template;
    this.meta = meta;
    this.description = description;
    this.tags = tags;
    this.style = style;
    this.title = '';
  }
  wrap(tag, value) {
    // increase indent
    value = `\n${value}`.replace(/\n/gm, `\n${this.indent}`);
    return `${tag[0]}${value}\n${tag[1]}`;
  }
  HTML(article) {
    this.article = article;
    this.meta = eval('`' + this.meta + '`');
    return eval('`' + this.template + '`');
  }
  root(node) {
    return this.wrap`<main>${node.value}</main>`
  }
  article(node) {
    let value = this.wrap`<article>${node.value}</article>`;
    if (this.amp) {
      // has amp url so not amp page
      value = `<link rel=stylesheet type=text/css href=//www.jxck.io/assets/css/article.css>\n${value}`
    }
    return value;
  }
  section(node) {
    return this.wrap`<section>${node.value}</section>\n`;
  }
  list(node) {
    return node.ordered ? this.wrap`<ol>${node.value}</ol>\n` : this.wrap`<ul>${node.value}</ul>\n`;
  }
  heading(node) {
    let val = '';
    if (node.depth === 1) {
      // h1 には独自ルールでタグを付けている
      // ex)
      // # [blog][web] ブログ始めました
      this.title = node.value;

      // tags をビルド
      let taglinks = this.tags.map((tag) => `<a>${tag}</a>`).join('');
      val += `<div><time datetime=${date}>${date}</time><span class=tags>${taglinks}</span></div>\n`;
      val += `<h${node.depth}><a href="/${this.canonical}">${node.value}</a></h${node.depth}>\n`;
    } else {
      val += `<h${node.depth} id="${unspace(node.value)}"><a href="#${unspace(node.value)}">${node.value}</a></h${node.depth}>\n`;
    }

    return val;
  }
  code       (node) {
    let value = `<pre class=${node.lang}><code>${node.value}</code></pre>\n`;
    if (this.amp) {
      // has amp url so not amp page
      value = `<link rel=stylesheet type=text/css href=//www.jxck.io/assets/css/pre.css>\n${value}`;
    }
    return value;
  }
  paragraph  (node) { return `<p>${node.value}\n` }
  // inline
  inlineCode (node) { return h`<code>${node.value}</code>` }
  blockquote (node) { return h`<blockquote>${node.value}</blockquote>\n` }
  listItem   (node) { return `<li>${node.value}\n` }
  link       (node) { return `<a href="${node.url}">${node.value}</a>` }
  image      (node) {
    if (!this.amp) {
      let size = node.url.split('#')[1].split('x');
      let width = size[0];
      let height = size[1];
      // not has amp link means amp template
      return  `<amp-img layout=responsive src=${node.url} alt="${node.alt}" title="${node.title}" width=${width} height=${height}>`
    }
    return `<img src=${node.url} alt="${node.alt}" title="${node.title}">`
  }
  strong     (node) { return `<strong>${node.value}</strong>` }
  emphasis   (node) { return `<em>${node.value}</em>` }
  html       (node) {
    let value = `${node.value}\n`;
    if (!this.amp && value.match(/<iframe.*/)) {
      // TODO: use amp-iframe in amp.html
      // return value.replace(/iframe/g, 'amp-iframe');

      return ''; // remove iframe in amp.html
    }
    return value;
  }
  text       (node) { return node.value }
  thematicBreak  () { return `<hr>` }
};

let p = function() {
  let arg = Array.from(arguments);
  arg.unshift(__LINE__);
  console.log.apply(this, arg);
}

let j = JSON.stringify.bind(JSON);

let parse = require('remark').parse;

function traverse(ast, option) {
  option.enter(ast);
  if(!ast.children) return option.leave(ast);

  ast.children = ast.children.map((child) => {
    return traverse(child, option);
  });
  return option.leave(ast);
}

// 改行したく無いタグ
function isInline(node) {
  return [
    'str',
    'header',
    'strong',
    'paragraph',
  ].indexOf(node.type) > -1;
}

function sectioning(children, depth) {
  // 最初のセクションは <article> にする
  let section = {
    type: depth === 1 ? 'article' : 'section',
    children: [],
    depth: depth,
  };

  // 横に並ぶべき <section> を入れる配列
  let sections = [];
  while (true) {
    // 横並びになっている子要素を取り出す
    let child = children.shift();
    if (child === undefined) break;

    // H2.. が来たらそこで section を追加する
    if (child.type === 'heading') {
      if (section.depth < child.depth) {
        // 一つレベルが下がる場合
        // 今の <section> の下に新しい <section> ができる
        // <section>
        //  <h2>
        //  <section>
        //    <h3> <- これ

        // その h を一旦戻す
        children.unshift(child);

        // そこを起点に再起する
        // そこに <section> ができて、
        // 戻した h を最初にできる
        Array.prototype.push.apply(section.children, sectioning(children, child.depth));
        continue;
      }
      else if (section.depth === child.depth) {
        // 同じレベルの h の場合
        // 同じレベルで別の <section> を作る必要がある
        // <section>
        //  <h2>
        // </section>
        // <section>
        //  <h2> <- これ

        // そこまでの sections を一旦終わらせて
        // 親の child に追加する
        // そして、同じレベルの新しい <section> を開始
        if (section.children.length > 0) {
          sections.push(section);
          section = {
            type: 'section',
            children: [],
            depth: child.depth,
          };
        }
        // もし今 section に子要素が無ければ
        // そのまま今の section に追加して良い
      }
      else if (section.depth > child.depth) {
        // レベルが一つ上がる場合
        // 今は一つ下がったレベルで再帰している最中だったが
        // それが終わったことを意味する
        // <section>
        //   <h2>
        //   <section>
        //     <h3>
        //     <p>
        //   <h2> <- 今ここ

        // その h を一旦戻す
        children.unshift(child);

        // ループを終わらせ関数を一つ抜ける
        break;
      }
    }

    // 今の <section> の子要素として追加
    section.children.push(child);
  }

  // 最後のセクションを追加
  sections.push(section);

  // そこまでの <section> のツリーを返す
  // 再帰している場合は、親の <section> の
  // childrens として使われる
  return sections;
}

function build(AST, dir, date, template) {
  // 結果を入れるスタック
  // push => unshift()
  // pop  => shift()
  // top  => [0]
  let stack = [];

  let codes = [];

  // トラバース
  traverse(AST, {
    enter(node) {
      // enter では、 inline 属性を追加し
      // stack に詰むだけ
      // 実際は、pop 側で整合検証くらいしか使ってない

      node.inline = isInline(node.type);
      stack.unshift(node);
    },
    leave(node) {
      if (node.type === 'code') {
        // コードを抜き取り、ここで id に置き換える
        // インデントを無視するため、全部組み上がったら後で差し込む。
        let value = node.value;
        if (value === '') {
          let tmp = node.lang.split(':');
          node.lang = tmp[0];
          let file = path.format({ dir: dir, base: tmp[1] });
          value = read(file);
        }
        codes.push(value);
        node.value = `// ${codes.length}`;
      }
      if (node.value) {
        // value があったら、 text とか

        // pop して
        let top = stack.shift();
        // 対応を確認
        if (top.type !== node.type) {
          console.error('ERROR', top, node);
          process.exit(1);
        }

        // 閉じる
        if (template[node.type] === undefined) {
          console.error('ERROR', node.type);
          process.exit(1);
        }
        stack.unshift({ tag: 'full', val: template[node.type](node), inline: isInline(node) });
      } else {
        // 完成している兄弟タグを集めてきて配列に並べる
        let vals = [];

        while (stack[0].tag === 'full') {
          let top = stack.shift();

          if (top.inline && vals[0] && vals[0].inline) {
            // 取得したのが inline で、一個前も inline だったら
            // inline どうしをくっつける
            let val = vals.shift();
            val.val = top.val + val.val;
            vals.unshift(val);
          } else {
            // そうで無ければただの兄弟要素
            vals.unshift(top);
          }
        }

        // タグを全部連結する
        vals = vals.map((val) => val.val).join('').trim();

        // それを親タグで閉じる
        let top = stack.shift();
        if (top.type !== node.type) {
          console.error('ERROR', top, node);
          process.exit(1);
        }

        // 今見ているのが paragraph で
        if (node.type === 'paragraph') {
          // その親が P いらないタグ だったら
          if (['listItem', 'blockquote'].indexOf(stack[0].type) > -1) {
            // Paragraph を消すために Str に差し替える
            // Str はタグをつけない
            node = { type: 'text' };
          }
        }

        node.value = vals;
        stack.unshift({ tag: 'full', val: template[node.type](node), inline: isInline(node) });
      }
    },
  });

  // 結果の <article> 結果
  let article = stack[0].val;

  let result = template.HTML(article);

  // indent を無視するため
  // ここで pre に code を戻す
  // ついでにエスケープ
  codes.forEach((code, i) => {
    result = result.replace(`// ${i+1}`, hsp(code));
  });

  return result;
}

if (process.argv.length < 3) {
  console.error('no file name');
  process.exit(1);
}

let path = require('path');
let fs = require('fs');
let filepath = process.argv[2];

let dir = path.parse(filepath).dir;
let name = path.parse(filepath).name;
let date = dir.split('/')[3];

let baseurl = dir.replace('./blog.jxck.io/', '');

// simple html
(() => {
  let md = read(filepath);

  // separate tag
  let parsed = Tags(md);
  let tags = parsed.tags;
  md = parsed.text;

  // take description
  let description = Description(md);

  let ast = parse(md, { position: false });
  ast.children = sectioning(ast.children, 1);

  let canonical = `${baseurl}/${name}.html`;
  let amp = `${baseurl}/${name}.amp.html`;
  let indent = '  ';
  let template = read('./.template/simple.html');
  let meta = read('./.template/meta.html');
  let simple = new Simple(canonical, amp, indent, template, meta, tags, description);

  let article = build(ast, dir, date, simple);

  let target = `${dir}/${name}.html`;
  fs.writeFileSync(target, article);
})();

// amp html
(() => {
  let md = read(filepath);

  // separate tag
  let parsed = Tags(md);
  let tags = parsed.tags;
  md = parsed.text;

  // take description
  let description = Description(md);

  let ast = parse(md);
  ast.children = sectioning(ast.children, 1);

  let canonical = `${baseurl}/${name}.html`;
  let indent = '  ';
  let template = read('./.template/amp.html');
  let meta = read('./.template/meta.html');
  let style = [
    'www.jxck.io/assets/css/body.css',
    'www.jxck.io/assets/css/header.css',
    'www.jxck.io/assets/css/main.css',
    'www.jxck.io/assets/css/article.css',
    'www.jxck.io/assets/css/pre.css',
    'www.jxck.io/assets/css/footer.css',
  ].map((file) => {
    return fs.readFileSync(file).toString();
  }).join('\n')

  let amp = new Simple(canonical, null, indent, template, meta, tags, description, style);

  let article = build(ast, dir, date, amp);

  let target = `${dir}/${name}.amp.html`;
  fs.writeFileSync(target, article);
})();
