import { Injectable, Logger } from '@nestjs/common';

/**
 * @description 阿里云百炼（DashScope）在「Ai提供商设置」里的提供商代码：探店的音色克隆与画外音配音都走它。
 * @keyword-cn 百炼提供商代码, 探店语音
 * @keyword-en dashscope-provider-code, store-visit-speech
 */
export const DASHSCOPE_PROVIDER_CODE = 'dashscope';

/**
 * @description 百炼提供商没填服务地址时的默认值：OpenAI 兼容地址，后台「测试」按钮用它的 `/models` 探活；
 *   CosyVoice 接口只取它的域名（见 `resolveDashScopeOrigin`）。
 * @keyword-cn 百炼默认地址, 兼容模式
 * @keyword-en dashscope-default-base-url, compatible-mode
 */
export const DASHSCOPE_DEFAULT_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

/**
 * @description 录音克隆音色默认绑定的合成模型；克隆出的音色只能用同一个模型配音。节点填了模型时以节点为准。
 * @keyword-cn 克隆音色模型, 声音复刻
 * @keyword-en cosyvoice-clone-model, voice-enrollment
 */
export const COSYVOICE_CLONE_MODEL = 'cosyvoice-v3.5-plus';

/**
 * @description 系统音色使用的合成模型：v3.5 系列不支持系统音色，v3-plus 只有两个，v3-flash 的系统音色最全。
 * @keyword-cn 系统音色模型, 预置音色
 * @keyword-en cosyvoice-preset-model, system-voice
 */
export const COSYVOICE_PRESET_MODEL = 'cosyvoice-v3-flash';

/**
 * @description 探店口播的默认念法：分段没写念法时交给百炼的自然语言指令，避免平铺直叙念台词。
 * @keyword-cn 默认念法, 口播语气
 * @keyword-en default-delivery, voiceover-tone
 */
export const COSYVOICE_DEFAULT_DELIVERY =
  '像跟朋友热情推荐一家好店，语气生动有起伏，重音落在卖点和价格上';

/**
 * @description 探店配音语速（百炼 `rate`，1 为音色原速）：克隆音色会照搬录音的慢节奏，探店口播要更紧凑，统一提到 1.15 倍。
 * @keyword-cn 探店配音语速, 口播语速
 * @keyword-en store-visit-speech-rate, voiceover-rate
 */
export const COSYVOICE_STORE_VISIT_RATE = 1.15;

/**
 * @description 念法里会被当成动作或画面的说法（推门、走进、指着、拿起、转身、边走边说、镜头、画面……）：念法只管声音怎么念，带这类说法的小句整句去掉。
 * @keyword-cn 念法动作说法, 念法清洗
 * @keyword-en delivery-action-pattern, delivery-cleanup
 */
export const DELIVERY_ACTION_PATTERN =
  /[推开进出]门|走[进到过向出]|边走|指[着向]|[拿举端]起|[拿举端]着|转身|回头|挥手|招手|镜头|画面|边.{1,6}边[说讲念]/;

/**
 * @description 清洗念法：去空白后按逗号、分号、句号拆成小句，带动作或画面说法的小句整句去掉，剩下的用逗号接回。
 * @keyword-cn 清洗念法, 去掉动作
 * @keyword-en clean-delivery, strip-actions
 * @param {string|undefined} text 念法。
 * @returns {string} 只描述声音的念法，全是动作时为空。
 */
export function cleanDelivery(text: string | undefined): string {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .split(/[，,；;。]/)
    .filter((clause) => clause && !DELIVERY_ACTION_PATTERN.test(clause))
    .join('，');
}

/**
 * @description 复刻 / 设计音色能用自然语言指令控制情感与语速的合成模型（百炼官方：v3.5-plus、v3.5-flash、v3-flash；v3-plus 的复刻与设计音色不支持）。
 * @keyword-cn 支持念法指令的模型, 自然语言指令
 * @keyword-en instruction-capable-models, natural-language-instruction
 */
export const COSYVOICE_NATURAL_INSTRUCTION_MODELS = [
  'cosyvoice-v3.5-plus',
  'cosyvoice-v3.5-flash',
  'cosyvoice-v3-flash',
] as const;

/**
 * @description 音色库里支持情感指令的系统音色与它们可用的场景（百炼官方音色列表里「Instruct：支持」的才有，须按固定格式填写）。
 * @keyword-cn 支持情感的系统音色, 固定格式指令
 * @keyword-en preset-instruction-voices, fixed-format-instruction
 */
export const COSYVOICE_PRESET_INSTRUCTION_SCENES: Readonly<
  Record<string, string>
> = { longanyang: '广告促销', longanhuan: '产品推广' };

/**
 * @description 按百炼规则计算指令长度：汉字算 2 个字符，其余（标点、字母、数字）算 1 个，上限 100。
 * @keyword-cn 指令长度, 百炼字符计数
 * @keyword-en instruction-length, dashscope-char-count
 * @param {string} text 指令。
 * @returns {number} 长度。
 */
export function cosyVoiceInstructionLength(text: string): number {
  return Array.from(text).reduce(
    (sum, char) => sum + (/[㐀-鿿豈-﫿]/.test(char) ? 2 : 1),
    0,
  );
}

/**
 * @description 把一段的念法转成百炼语音合成的 `instruction`（先用 `cleanDelivery` 去掉动作、画面说法）：复刻 / 设计音色在支持的模型上用自然语言（没写念法用默认念法，截到 100 个字符内）；
 *   音色库里支持情感的系统音色用固定格式「你正在进行<场景>，你说话的情感是<happy|surprised>。」；其余音色不支持，返回空。
 * @keyword-cn 念法转合成指令, 情感指令
 * @keyword-en delivery-to-instruction, emotion-instruction
 * @param {{model: string, voiceId: string, voiceSource?: string, delivery?: string}} input 合成模型、音色、音色来源与这一段的念法。
 * @returns {string|undefined} 指令，不支持时为空。
 */
export function buildCosyVoiceInstruction(input: {
  model: string;
  voiceId: string;
  voiceSource?: string;
  delivery?: string;
}): string | undefined {
  const delivery = cleanDelivery(input.delivery);
  const scene = COSYVOICE_PRESET_INSTRUCTION_SCENES[input.voiceId];
  if (input.voiceSource === 'preset' || scene) {
    if (!scene || !/^cosyvoice-v3-(flash|plus)$/.test(input.model))
      return undefined;
    const emotion = /惊|哇|没想到|居然|竟然/.test(delivery)
      ? 'surprised'
      : 'happy';
    return `你正在进行${scene}，你说话的情感是${emotion}。`;
  }
  if (
    !(COSYVOICE_NATURAL_INSTRUCTION_MODELS as readonly string[]).includes(
      input.model,
    )
  )
    return undefined;
  let text = delivery || COSYVOICE_DEFAULT_DELIVERY;
  while (cosyVoiceInstructionLength(text) > 100)
    text = Array.from(text).slice(0, -1).join('');
  return text;
}

/**
 * @description 配音输出采样率：WAV 16bit 单声道，时长可以从文件头精确算出，用来决定这一段画面生成多少秒。
 * @keyword-cn 配音采样率, 配音格式
 * @keyword-en tts-sample-rate, tts-format
 */
export const COSYVOICE_SAMPLE_RATE = 24000;

/**
 * @description 等待克隆音色审核通过的最长时间（百炼一般几秒就是 OK）。
 * @keyword-cn 音色审核等待, 克隆超时
 * @keyword-en voice-review-timeout, clone-timeout
 */
export const COSYVOICE_VOICE_READY_TIMEOUT_MS = 90 * 1000;

/**
 * @description 音色库的风格分类键：活力种草、温柔亲切、知性专业、方言特色。
 * @keyword-cn 音色分类键, 音色风格
 * @keyword-en voice-category-key, voice-style
 */
export type CosyVoicePresetCategory =
  'lively' | 'gentle' | 'steady' | 'dialect';

/**
 * @description 音色库分类目录（顺序即展示顺序）：每个分类都同时有男声和女声。
 * @keyword-cn 音色分类目录, 男女声分类
 * @keyword-en voice-category-catalog, gender-balanced-category
 */
export const COSYVOICE_PRESET_CATEGORIES: ReadonlyArray<{
  key: CosyVoicePresetCategory;
  label: string;
  hint: string;
}> = [
  {
    key: 'lively',
    label: '活力种草',
    hint: '热情带感，适合探店推荐、带货种草',
  },
  {
    key: 'gentle',
    label: '温柔亲切',
    hint: '像朋友聊天，适合咖啡、甜品、生活方式',
  },
  {
    key: 'steady',
    label: '知性专业',
    hint: '清晰稳重，适合讲解产品、品牌介绍',
  },
  {
    key: 'dialect',
    label: '方言特色',
    hint: '地方口音，适合本地老店、风味小吃',
  },
];

/**
 * @description 探店音色库里的一个 CosyVoice 预置音色。
 * @keyword-cn 预置音色条目, 探店音色
 * @keyword-en cosyvoice-preset-voice, store-visit-voice
 */
export interface CosyVoicePresetVoice {
  voiceId: string;
  voiceName: string;
  /** @description 声音特质，例如「阳光大男孩」 */
  trait: string;
  gender: 'male' | 'female';
  /** @description 风格分类，见 `COSYVOICE_PRESET_CATEGORIES` */
  category: CosyVoicePresetCategory;
  /** @description 方言音色标注方言，普通话为空 */
  dialect?: string;
}

/**
 * @description 探店音色库（`cosyvoice-v3-flash` 预置音色，华北 2 北京可用）：按官方音色列表挑了适合口播的普通话男女声和两个方言音色，
 *   分到四个风格分类里，每个分类男女声都有。
 * @keyword-cn 系统音色目录, 探店音色库
 * @keyword-en cosyvoice-preset-catalog, store-visit-voice-library
 */
export const COSYVOICE_PRESET_VOICES: readonly CosyVoicePresetVoice[] = [
  {
    voiceId: 'longanyang',
    voiceName: '龙安洋',
    trait: '阳光大男孩',
    gender: 'male',
    category: 'lively',
  },
  {
    voiceId: 'longanhuan',
    voiceName: '龙安欢',
    trait: '欢脱元气女',
    gender: 'female',
    category: 'lively',
  },
  {
    voiceId: 'longxiaochun_v3',
    voiceName: '龙小淳',
    trait: '知性积极女',
    gender: 'female',
    category: 'steady',
  },
  {
    voiceId: 'longanlang_v3',
    voiceName: '龙安朗',
    trait: '清爽利落男',
    gender: 'male',
    category: 'steady',
  },
  {
    voiceId: 'longhua_v3',
    voiceName: '龙华',
    trait: '元气甜美女',
    gender: 'female',
    category: 'lively',
  },
  {
    voiceId: 'longanyun_v3',
    voiceName: '龙安昀',
    trait: '居家暖男',
    gender: 'male',
    category: 'gentle',
  },
  {
    voiceId: 'longanqin_v3',
    voiceName: '龙安亲',
    trait: '亲和活泼女',
    gender: 'female',
    category: 'lively',
  },
  {
    voiceId: 'longze_v3',
    voiceName: '龙泽',
    trait: '温暖元气男',
    gender: 'male',
    category: 'gentle',
  },
  {
    voiceId: 'longxing_v3',
    voiceName: '龙星',
    trait: '温婉邻家女',
    gender: 'female',
    category: 'gentle',
  },
  {
    voiceId: 'longcheng_v3',
    voiceName: '龙橙',
    trait: '智慧青年男',
    gender: 'male',
    category: 'steady',
  },
  {
    voiceId: 'longanrou_v3',
    voiceName: '龙安柔',
    trait: '温柔闺蜜女',
    gender: 'female',
    category: 'gentle',
  },
  {
    voiceId: 'longyichen_v3',
    voiceName: '龙逸尘',
    trait: '洒脱活力男',
    gender: 'male',
    category: 'lively',
  },
  {
    voiceId: 'longyingxiao_v3',
    voiceName: '龙应笑',
    trait: '清甜推销女',
    gender: 'female',
    category: 'lively',
  },
  {
    voiceId: 'longanzhi_v3',
    voiceName: '龙安智',
    trait: '睿智轻熟男',
    gender: 'male',
    category: 'steady',
  },
  {
    voiceId: 'longanwen_v3',
    voiceName: '龙安温',
    trait: '优雅知性女',
    gender: 'female',
    category: 'steady',
  },
  {
    voiceId: 'longtian_v3',
    voiceName: '龙天',
    trait: '磁性理智男',
    gender: 'male',
    category: 'steady',
  },
  {
    voiceId: 'longanli_v3',
    voiceName: '龙安莉',
    trait: '利落从容女',
    gender: 'female',
    category: 'steady',
  },
  {
    voiceId: 'longnan_v3',
    voiceName: '龙楠',
    trait: '睿智青年男',
    gender: 'male',
    category: 'steady',
  },
  {
    voiceId: 'longwan_v3',
    voiceName: '龙婉',
    trait: '细腻柔声女',
    gender: 'female',
    category: 'gentle',
  },
  {
    voiceId: 'longsanshu_v3',
    voiceName: '龙三叔',
    trait: '沉稳质感男',
    gender: 'male',
    category: 'steady',
  },
  {
    voiceId: 'longxiaoxia_v3',
    voiceName: '龙小夏',
    trait: '沉稳权威女',
    gender: 'female',
    category: 'steady',
  },
  {
    voiceId: 'longfei_v3',
    voiceName: '龙飞',
    trait: '热血磁性男',
    gender: 'male',
    category: 'lively',
  },
  {
    voiceId: 'longmiao_v3',
    voiceName: '龙妙',
    trait: '抑扬顿挫女',
    gender: 'female',
    category: 'steady',
  },
  {
    voiceId: 'longyumi_v3',
    voiceName: 'YUMI',
    trait: '正经青年女',
    gender: 'female',
    category: 'steady',
  },
  {
    voiceId: 'longlaotie_v3',
    voiceName: '龙老铁',
    trait: '东北直率男',
    gender: 'male',
    category: 'dialect',
    dialect: '东北话',
  },
  {
    voiceId: 'longjiaxin_v3',
    voiceName: '龙嘉欣',
    trait: '优雅粤语女',
    gender: 'female',
    category: 'dialect',
    dialect: '粤语',
  },
];

/**
 * @description 百炼接口需要的提供商运行配置（服务地址与 Key）。
 * @keyword-cn 百炼运行配置, 语音服务配置
 * @keyword-en dashscope-runtime, speech-runtime
 */
export interface DashScopeRuntime {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * @description 取百炼服务的域名：后台填的是兼容模式地址（`…/compatible-mode/v1`）或业务空间专属域名都只取 origin，
 *   CosyVoice 接口统一拼在 `{origin}/api/v1/services/audio/tts/…` 下面；没填或填错时用默认域名。
 * @keyword-cn 百炼服务域名, 去掉兼容路径
 * @keyword-en dashscope-origin, strip-compatible-path
 * @param {string} [baseUrl] 提供商服务地址。
 * @returns {string} 形如 `https://dashscope.aliyuncs.com` 的域名。
 */
export function resolveDashScopeOrigin(baseUrl?: string): string {
  const value = String(baseUrl ?? '').trim() || DASHSCOPE_DEFAULT_BASE_URL;
  try {
    return new URL(value).origin;
  } catch {
    return new URL(DASHSCOPE_DEFAULT_BASE_URL).origin;
  }
}

/**
 * @description 生成克隆音色的名称前缀：百炼要求只含字母数字、不超过 10 个字符，这里用 `aim` + 脚本 ID 的 36 进制。
 * @keyword-cn 克隆音色前缀, 音色命名
 * @keyword-en clone-voice-prefix, voice-naming
 * @param {number} topicId 子选题（脚本）ID。
 * @returns {string} 前缀。
 */
export function buildCosyVoicePrefix(topicId: number): string {
  const seed = Math.max(0, Math.round(Number(topicId) || 0)).toString(36);
  return `aim${seed}`.slice(0, 10);
}

/**
 * @description 从 WAV 文件头算出时长（秒）：按 `fmt ` 块的字节率与 `data` 块大小计算；`data` 大小为 0 或写成流式占位值时按文件剩余长度算。
 *   不是 WAV 时返回 0。
 * @keyword-cn WAV时长, 配音时长
 * @keyword-en wav-duration, voiceover-seconds
 * @param {Buffer} buffer WAV 文件内容。
 * @returns {number} 时长（秒），保留两位小数。
 */
export function readWavSeconds(buffer: Buffer): number {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  )
    return 0;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && start + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(start + 8);
    } else if (id === 'data') {
      if (!byteRate) return 0;
      const available = buffer.length - start;
      const dataSize =
        size === 0 || size === 0xffffffff || size > available
          ? available
          : size;
      return Math.round((dataSize / byteRate) * 100) / 100;
    }
    offset = start + size + (size % 2);
  }
  return 0;
}

/**
 * @description 收紧配音里的空白：16bit PCM WAV 按 10 毫秒一帧算音量，低于「最响一帧的 2.5%（不低于 100）」算静音，短于 30 毫秒的孤立声响（咔哒、唇音）也当静音；
 *   开口前只留 0.08 秒、说完后留 0.15 秒，句中超过 0.3 秒的停顿缩到 0.3 秒（从停顿中间剪，两头各留一半）。不是 16bit PCM、解析不了或整段静音时原样返回。
 * @keyword-cn 收紧配音停顿, 去掉首尾静音
 * @keyword-en tighten-speech-pauses, trim-silence
 * @param {Buffer} buffer WAV 文件内容。
 * @returns {Buffer} 收紧后的 WAV（重写为标准 44 字节文件头），无需收紧时返回原内容。
 */
export function tightenSpeechPauses(buffer: Buffer): Buffer {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  )
    return buffer;
  let offset = 12;
  let fmt:
    | { format: number; channels: number; sampleRate: number; bits: number }
    | undefined;
  let data: { start: number; size: number } | undefined;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && start + 16 <= buffer.length) {
      fmt = {
        format: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bits: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      const available = buffer.length - start;
      data = {
        start,
        size:
          size === 0 || size === 0xffffffff || size > available
            ? available
            : size,
      };
      break;
    }
    offset = start + size + (size % 2);
  }
  if (
    !fmt ||
    !data ||
    fmt.format !== 1 ||
    fmt.bits !== 16 ||
    !fmt.channels ||
    !fmt.sampleRate
  )
    return buffer;
  const block = fmt.channels * 2;
  const dataStart = data.start;
  const frames = Math.floor(data.size / block);
  const step = Math.max(1, Math.round(fmt.sampleRate * 0.01));
  const count = Math.ceil(frames / step);
  const loudness: number[] = [];
  for (let window = 0; window < count; window++) {
    let sum = 0;
    let samples = 0;
    const end = Math.min(frames, (window + 1) * step);
    for (let frame = window * step; frame < end; frame++)
      for (let channel = 0; channel < fmt.channels; channel++) {
        const value = buffer.readInt16LE(
          dataStart + frame * block + channel * 2,
        );
        sum += value * value;
        samples++;
      }
    loudness.push(samples ? Math.sqrt(sum / samples) : 0);
  }
  const threshold = Math.max(100, Math.max(0, ...loudness) * 0.025);
  const voiced = loudness.map((value) => value >= threshold);
  for (let window = 0; window < count;) {
    if (!voiced[window]) {
      window++;
      continue;
    }
    let end = window;
    while (end < count && voiced[end]) end++;
    if (end - window < 3) voiced.fill(false, window, end);
    window = end;
  }
  const first = voiced.indexOf(true);
  if (first < 0) return buffer;
  const last = voiced.lastIndexOf(true);
  const maxPause = 30;
  const ranges: Array<[number, number]> = [];
  let from = Math.max(0, first - 8);
  for (let window = first; window <= last;) {
    if (voiced[window]) {
      window++;
      continue;
    }
    let end = window;
    while (!voiced[end]) end++;
    if (end - window > maxPause) {
      ranges.push([from, window + maxPause / 2]);
      from = end - maxPause / 2;
    }
    window = end;
  }
  ranges.push([from, Math.min(count, last + 1 + 15)]);
  const pcm = Buffer.concat(
    ranges.map(([start, end]) =>
      buffer.subarray(
        dataStart + start * step * block,
        dataStart + Math.min(frames, end * step) * block,
      ),
    ),
  );
  if (pcm.length >= frames * block) return buffer;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(fmt.channels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(fmt.sampleRate * block, 28);
  header.writeUInt16LE(block, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * @description 把百炼语音接口的报错整理成中文：Key 无效、限流、音色与模型不匹配、录音不合格分别说明，其余带上原始信息。
 * @keyword-cn 百炼语音报错, 中文说明
 * @keyword-en cosyvoice-error-message, friendly-error
 * @param {string} raw 原始报错（`DASHSCOPE_HTTP_<状态码>:<响应体>` 或网络错误）。
 * @returns {string} 用户可读说明。
 */
export function describeCosyVoiceFailure(raw: string): string {
  const text = String(raw ?? '');
  if (/InvalidApiKey|HTTP_401/i.test(text))
    return '百炼 API Key 无效或已失效，请管理员到「Ai提供商设置」更新';
  if (/Throttling|HTTP_429|RateQuota/i.test(text))
    return '百炼语音请求太频繁，请稍后重试';
  if (/Arrearage|Overdue|欠费/i.test(text))
    return '百炼账号欠费，语音暂时无法使用，请联系平台管理员处理后重试';
  if (/error code: 418|voice.*not.*(found|exist)|InvalidVoice/i.test(text))
    return '音色不可用（音色已删除，或与合成模型不匹配），请重新选择或克隆音色';
  if (/DASHSCOPE_VOICE_REJECTED/.test(text))
    return '录音没有通过百炼的音色审核，请换一段 10～20 秒、单人、安静环境下的清晰人声重新克隆';
  if (/DASHSCOPE_VOICE_REVIEW_TIMEOUT/.test(text))
    return '音色审核超时，请稍后重新克隆';
  if (/DASHSCOPE_HTTP_400:\/customization/.test(text))
    return '录音不符合克隆要求：请上传 10～20 秒、单人、安静环境下的清晰人声';
  if (/NETWORK_ERROR|fetch failed|timeout/i.test(text))
    return '连接百炼语音服务超时，请检查网络后重试';
  const message = /"message"\s*:\s*"([^"]{1,200})"/.exec(text)?.[1];
  return `百炼语音服务出错${message ? `：${message}` : ''}`;
}

/**
 * @description 把百炼声音设计的报错翻成中文：描述没通过或不合要求时提示换个说法，其余沿用通用语音报错说明。
 * @keyword-cn 声音设计报错, 中文说明
 * @keyword-en voice-design-error-message, friendly-error
 * @param {string} raw 原始报错。
 * @returns {string} 用户可读说明。
 */
export function describeVoiceDesignFailure(raw: string): string {
  const text = String(raw ?? '');
  if (/DASHSCOPE_VOICE_REJECTED|DASHSCOPE_HTTP_400:\/customization/.test(text))
    return '这段描述没能生成音色，换个说法再试：写清性别、大概年龄、音色特点和说话语气，只用中文或英文';
  if (/DASHSCOPE_VOICE_REVIEW_TIMEOUT/.test(text))
    return '音色生成超时，请稍后重试';
  return describeCosyVoiceFailure(text);
}

/**
 * @description 阿里云百炼 CosyVoice 客户端：声音复刻（创建、查询审核状态、删除音色）、按提示词设计音色与非实时语音合成。
 *   探店画外音用它克隆用户录音、给每段台词配音；Key 与地址来自后台「音色克隆」节点选的百炼提供商。
 * @keyword-cn 百炼CosyVoice, 声音复刻, 语音合成
 * @keyword-en dashscope-cosyvoice, voice-enrollment, speech-synthesis
 */
@Injectable()
export class DouyinCosyVoiceService {
  private readonly logger = new Logger(DouyinCosyVoiceService.name);

  /**
   * @description 用一段公网可访问的录音创建克隆音色，返回音色 ID（此时可能还在审核，要再 `waitVoiceReady`）。
   * @keyword-cn 创建克隆音色, 声音复刻
   * @keyword-en create-cloned-voice, enroll-voice
   * @param {DashScopeRuntime} runtime 百炼地址与 Key。
   * @param {{targetModel: string, prefix: string, audioUrl: string}} input 绑定的合成模型、名称前缀与录音地址。
   * @returns {Promise<string>} 音色 ID。
   * @throws {Error} 百炼返回错误或没给音色 ID。
   */
  async createVoice(
    runtime: DashScopeRuntime,
    input: { targetModel: string; prefix: string; audioUrl: string },
  ): Promise<string> {
    const response = await this.post(runtime, '/customization', {
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: input.targetModel,
        prefix: input.prefix,
        url: input.audioUrl,
      },
    });
    const voiceId = String(
      (response.output as Record<string, unknown> | undefined)?.voice_id ?? '',
    ).trim();
    if (!voiceId) throw new Error('DASHSCOPE_VOICE_ID_MISSING');
    return voiceId;
  }

  /**
   * @description 按一段文字描述设计音色（百炼 CosyVoice 声音设计，仅北京地域），返回音色 ID（可能还在部署，要再 `waitVoiceReady`）。
   * @keyword-cn 提示词设计音色, 声音设计
   * @keyword-en design-voice-from-prompt, voice-design
   * @param {DashScopeRuntime} runtime 百炼地址与 Key。
   * @param {{targetModel: string, prefix: string, prompt: string, previewText: string}} input 绑定的合成模型、名称前缀、声音描述（≤500 字）与试听文本（15～200 字）。
   * @returns {Promise<string>} 音色 ID。
   * @throws {Error} 百炼返回错误或没给音色 ID。
   */
  async designVoice(
    runtime: DashScopeRuntime,
    input: {
      targetModel: string;
      prefix: string;
      prompt: string;
      previewText: string;
    },
  ): Promise<string> {
    const response = await this.post(runtime, '/customization', {
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: input.targetModel,
        prefix: input.prefix,
        voice_prompt: input.prompt.slice(0, 500),
        preview_text: input.previewText.slice(0, 200),
        language_hints: ['zh'],
      },
      parameters: {
        sample_rate: COSYVOICE_SAMPLE_RATE,
        response_format: 'wav',
      },
    });
    const voiceId = String(
      (response.output as Record<string, unknown> | undefined)?.voice_id ?? '',
    ).trim();
    if (!voiceId) throw new Error('DASHSCOPE_VOICE_ID_MISSING');
    return voiceId;
  }

  /**
   * @description 轮询克隆音色的审核状态，直到 `OK`；`UNDEPLOYED`（审核不通过）或超时抛错。
   * @keyword-cn 等待音色审核, 克隆音色状态
   * @keyword-en wait-voice-ready, voice-review-status
   * @param {DashScopeRuntime} runtime 百炼地址与 Key。
   * @param {string} voiceId 音色 ID。
   * @param {number} [timeoutMs] 最长等待毫秒数。
   * @returns {Promise<void>} 审核通过。
   * @throws {Error} 审核不通过或超时。
   */
  async waitVoiceReady(
    runtime: DashScopeRuntime,
    voiceId: string,
    timeoutMs = COSYVOICE_VOICE_READY_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const response = await this.post(runtime, '/customization', {
        model: 'voice-enrollment',
        input: { action: 'query_voice', voice_id: voiceId },
      });
      const status = String(
        (response.output as Record<string, unknown> | undefined)?.status ?? '',
      ).toUpperCase();
      if (status === 'OK') return;
      if (status === 'UNDEPLOYED') throw new Error('DASHSCOPE_VOICE_REJECTED');
      if (Date.now() > deadline)
        throw new Error('DASHSCOPE_VOICE_REVIEW_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  /**
   * @description 删除一个克隆音色（换音色时清掉旧的），失败不抛错。
   * @keyword-cn 删除克隆音色, 清理旧音色
   * @keyword-en delete-cloned-voice, cleanup-old-voice
   * @param {DashScopeRuntime} runtime 百炼地址与 Key。
   * @param {string} voiceId 音色 ID。
   * @returns {Promise<boolean>} 是否删除成功。
   */
  async deleteVoice(
    runtime: DashScopeRuntime,
    voiceId: string,
  ): Promise<boolean> {
    try {
      await this.post(runtime, '/customization', {
        model: 'voice-enrollment',
        input: { action: 'delete_voice', voice_id: voiceId },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @description 非实时语音合成：按音色把一段文字念成 24kHz 单声道 WAV，下载回来并从文件头算出时长；带 `instruction`（念法指令）时控制情感，带 `rate` 时按倍数调语速（1 为原速，不传），
   *   百炼拒绝念法指令时退回不带指令（语速照带）再合成一次，不让整段失败。百炼给的是 24 小时有效的临时地址，调用方需要自己转存。
   * @keyword-cn 合成配音, 画外音配音
   * @keyword-en synthesize-voiceover, cosyvoice-tts
   * @param {DashScopeRuntime} runtime 百炼地址与 Key。
   * @param {{model: string, voice: string, text: string, instruction?: string, rate?: number}} input 合成模型、音色 ID、文字、念法指令与语速倍数（0.5～2）。
   * @returns {Promise<{buffer: Buffer, seconds: number, characters: number, url: string}>} 音频内容、时长、计费字符数与临时地址。
   * @throws {Error} 合成或下载失败、音频为空。
   */
  async synthesize(
    runtime: DashScopeRuntime,
    input: {
      model: string;
      voice: string;
      text: string;
      instruction?: string;
      rate?: number;
    },
  ): Promise<{
    buffer: Buffer;
    seconds: number;
    characters: number;
    url: string;
  }> {
    /** @description 发一次合成请求，可选带念法指令。 @keyword-cn 发合成请求, 带念法指令 @keyword-en request-synthesis, with-instruction */
    const request = (instruction?: string) =>
      this.post(runtime, '/SpeechSynthesizer', {
        model: input.model,
        input: {
          text: input.text,
          voice: input.voice,
          format: 'wav',
          sample_rate: COSYVOICE_SAMPLE_RATE,
          ...(input.rate && input.rate !== 1 ? { rate: input.rate } : {}),
          ...(instruction ? { instruction } : {}),
        },
      });
    const response = input.instruction
      ? await request(input.instruction).catch((error: unknown) => {
          this.logger.warn(
            `[synthesize] 带念法指令合成失败，改为不带指令重试 model=${input.model}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return request();
        })
      : await request();
    const output = response.output as { audio?: { url?: string } } | undefined;
    const url = String(output?.audio?.url ?? '')
      .trim()
      .replace(/^http:\/\//i, 'https://');
    if (!url) throw new Error('DASHSCOPE_TTS_URL_MISSING');
    const download = await fetch(url, {
      signal: AbortSignal.timeout(60 * 1000),
    });
    if (!download.ok)
      throw new Error(`DASHSCOPE_TTS_DOWNLOAD_FAILED:${download.status}`);
    const buffer = Buffer.from(await download.arrayBuffer());
    const seconds = readWavSeconds(buffer);
    if (!seconds) throw new Error('DASHSCOPE_TTS_EMPTY_AUDIO');
    const usage = response.usage as { characters?: number } | undefined;
    return {
      buffer,
      seconds,
      characters: Number(usage?.characters) || 0,
      url,
    };
  }

  /**
   * @description 合成一句试听，只返回百炼的临时地址（24 小时有效，已换成 https），不下载；带 `rate` 时按同样的语速念，试听与成片一致。
   * @keyword-cn 合成试听, 音色试听
   * @keyword-en synthesize-preview, voice-trial
   * @param {DashScopeRuntime} runtime 百炼地址与 Key。
   * @param {{model: string, voice: string, text: string, rate?: number}} input 合成模型、音色 ID、试听文字与语速倍数。
   * @returns {Promise<{url: string, expiresAt?: number}>} 试听地址与过期时间（秒级时间戳）。
   * @throws {Error} 合成失败。
   */
  async synthesizePreview(
    runtime: DashScopeRuntime,
    input: { model: string; voice: string; text: string; rate?: number },
  ): Promise<{ url: string; expiresAt?: number }> {
    const response = await this.post(runtime, '/SpeechSynthesizer', {
      model: input.model,
      input: {
        text: input.text,
        voice: input.voice,
        format: 'mp3',
        ...(input.rate && input.rate !== 1 ? { rate: input.rate } : {}),
      },
    });
    const audio = (
      response.output as
        { audio?: { url?: string; expires_at?: number } } | undefined
    )?.audio;
    const url = String(audio?.url ?? '')
      .trim()
      .replace(/^http:\/\//i, 'https://');
    if (!url) throw new Error('DASHSCOPE_TTS_URL_MISSING');
    return { url, expiresAt: Number(audio?.expires_at) || undefined };
  }

  /**
   * @description 调一次百炼语音接口（`{origin}/api/v1/services/audio/tts{path}`）：带 Bearer 与 1 分钟超时；
   *   非 2xx 或响应带 `code` 时抛 `DASHSCOPE_HTTP_<状态码>:<响应体>`，保留对端报错供排查。
   * @keyword-cn 百炼语音请求, 错误体保留
   * @keyword-en dashscope-speech-request, preserve-error-body
   * @param {DashScopeRuntime} runtime 百炼地址与 Key。
   * @param {string} path `/customization` 或 `/SpeechSynthesizer`。
   * @param {Record<string, unknown>} body 请求体。
   * @returns {Promise<Record<string, unknown>>} JSON 响应。
   */
  private async post(
    runtime: DashScopeRuntime,
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const apiKey = String(runtime.apiKey ?? '').trim();
    if (!apiKey) throw new Error('DASHSCOPE_HTTP_401:InvalidApiKey');
    let response: Response;
    try {
      response = await fetch(
        `${resolveDashScopeOrigin(runtime.baseUrl)}/api/v1/services/audio/tts${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60 * 1000),
        },
      );
    } catch (error) {
      throw new Error(`DASHSCOPE_NETWORK_ERROR:${String(error)}`);
    }
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { raw: text.slice(0, 1000) };
    }
    if (!response.ok || (typeof data.code === 'string' && data.code))
      throw new Error(
        `DASHSCOPE_HTTP_${response.status}:${path}:${JSON.stringify(data).slice(0, 2000)}`,
      );
    return data;
  }
}
