/* ============================================================================
   HOMURA · Markdown 渲染
   ----------------------------------------------------------------------------
   .md 文件先转成 HTML，再走小说渲染管道。这里的输出会进 v-html，
   所以刻意关掉原始 HTML 注入、并过滤链接协议，避免笔记里夹带脚本。
   ========================================================================== */

import { Marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { escapeHtml, isSafeLinkUrl } from './utils.ts';

const marked = new Marked({
  gfm: true,
  // 普通单换行保留为软换行；行尾双空格或反斜杠才生成硬换行。
  breaks: false,
  async: false
});

marked.use({
  renderer: {
    // 原始 HTML 一律转义展示，不交给浏览器执行
    html({ text }) {
      return escapeHtml(text);
    },
    link(token) {
      if (isSafeLinkUrl(token.href)) return false;
      // 链接文本必须走内联解析：原始 HTML 会交给 html() 渲染器转义，
      // 直接拼 token.text 会把 <img onerror> 之类标签原样注入（存储型 XSS）
      const text = token.tokens
        ? this.parser.parseInline(token.tokens)
        : escapeHtml(token.text);
      return text;
    },
    image(token) {
      if (!isSafeLinkUrl(token.href)) return escapeHtml(token.text || '');
      // 安全检查通过后沿用标准渲染器，保留图片标题、纯文本 alt 与 URL 编码。
      return false;
    }
  }
});

export function renderMarkdown(source: string) {
  return marked.parse(source, { async: false });
}

export function splitMarkdownChapters(source: string, fallbackTitle: string) {
  // 先解析全文，使跨章节引用定义生效；只按顶层标题切分，代码/列表/引用不拆章。
  const tokens = marked.lexer(source);
  const chapters: { title: string; htmlContent: string }[] = [];
  let buffer: Token[] = [];
  let heading: Tokens.Heading | null = null;

  const flush = () => {
    const html = marked.parser(buffer).trim();
    buffer = [];
    if (!html && !heading) return;
    const title = heading
      ? new DOMParser().parseFromString(marked.parser([heading]), 'text/html').body.textContent?.trim()
      : '开始';
    chapters.push({
      title: title || fallbackTitle,
      // 标题由阅读器章首页展示；只有标题的章节也不能丢失。
      htmlContent: html || '<p></p>'
    });
  };

  for (const token of tokens) {
    if (token.type === 'heading' && token.depth <= 2) {
      flush();
      heading = token as Tokens.Heading;
    } else {
      buffer.push(token);
    }
  }
  flush();

  if (!chapters.length) chapters.push({ title: fallbackTitle, htmlContent: '<p>（空文件）</p>' });
  return chapters;
}
