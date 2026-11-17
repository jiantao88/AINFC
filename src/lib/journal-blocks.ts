/**
 * 游记正文里的配图占位符:单独一行的 [图N],N 从 1 开始,对应 card.photoIds 的顺序。
 * 本文件是纯函数,不依赖服务端配置,生成端(校验)和展示端(排版)共用。
 */

export type JournalBlock = { type: "text"; text: string } | { type: "photo"; index: number };

export interface JournalLayout {
  blocks: JournalBlock[];
}

const MARK = /([\[【]\s*图\s*\d{1,2}\s*[\]】])/;
const MARK_G = /[\[【]\s*图\s*\d{1,2}\s*[\]】]/g;

type Token = { t: "text"; s: string } | { t: "photo"; n: number };

function tokenize(body: string): Token[] {
  const out: Token[] = [];
  for (const line of body.split(/\r?\n/)) {
    for (const piece of line.split(MARK)) {
      const m = piece.match(/\d{1,2}/);
      if (MARK.test(piece) && m) out.push({ t: "photo", n: Number(m[0]) });
      else if (piece.trim()) out.push({ t: "text", s: piece.trim() });
    }
  }
  return out;
}

/** 去掉所有占位符。事实校验和字数统计前使用,避免 [图2] 里的数字被当成正文数字 */
export function stripMarkers(body: string): string {
  return body.replace(MARK_G, "");
}

/**
 * 整理模型输出:占位符一律独占一行,序号越界或重复的丢弃,第一段之前的占位符丢弃。
 * 返回的字符串里,段落之间和段落与占位符之间都空一行。
 */
export function normalizeJournalBody(body: string, photoCount: number): string {
  const used = new Set<number>();
  const parts: string[] = [];
  let seenText = false;
  for (const tk of tokenize(body)) {
    if (tk.t === "text") {
      parts.push(tk.s);
      seenText = true;
    } else if (seenText && tk.n >= 1 && tk.n <= photoCount && !used.has(tk.n)) {
      used.add(tk.n);
      parts.push(`[图${tk.n}]`);
    }
  }
  return parts.join("\n\n");
}

/**
 * 把正文拆成文字块和照片块。照片永远穿插在段落之间,不会堆在文末。
 * - 正文里有有效占位符:照片出现在占位符的位置。
 * - 没被引用的照片(模型漏引、没有占位符的旧数据和模板游记):补进还没有配图的段落后面,
 *   尽量均匀;段落不够用时,叠在配图最少的段落后面。
 */
export function splitJournal(body: string, photoCount: number): JournalLayout {
  const lead: number[] = []; // 第一段文字之前的照片
  const paras: { text: string; photos: number[] }[] = [];
  const used = new Set<number>();
  for (const tk of tokenize(body)) {
    if (tk.t === "text") paras.push({ text: tk.s, photos: [] });
    else if (tk.n >= 1 && tk.n <= photoCount && !used.has(tk.n)) {
      used.add(tk.n);
      (paras.length ? paras[paras.length - 1].photos : lead).push(tk.n - 1);
    }
  }

  const left: number[] = [];
  for (let i = 0; i < photoCount; i++) if (!used.has(i + 1)) left.push(i);

  if (paras.length === 0) lead.push(...left);
  else if (left.length) {
    const empty = paras.map((_, i) => i).filter((i) => paras[i].photos.length === 0);
    const k = Math.min(left.length, empty.length);
    for (let j = 0; j < k; j++) paras[empty[Math.floor((j * empty.length) / k)]].photos.push(left[j]);
    for (const idx of left.slice(k)) {
      let best = 0;
      paras.forEach((p, i) => {
        if (p.photos.length < paras[best].photos.length) best = i;
      });
      paras[best].photos.push(idx);
    }
  }

  const blocks: JournalBlock[] = lead.map((index) => ({ type: "photo", index }));
  for (const p of paras) {
    blocks.push({ type: "text", text: p.text });
    for (const index of p.photos) blocks.push({ type: "photo", index });
  }
  return { blocks };
}
