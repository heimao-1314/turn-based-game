const EMOJI_LABELS = [
  "微笑", "开心", "大笑", "害羞", "惊讶", "调皮", "脸红", "生气", "委屈", "爱心眼", "得意", "吐舌", "流泪", "酷", "疑惑", "可怜", "发呆", "无语", "眨眼", "亲亲", "困倦", "坏笑", "尴尬", "大哭", "咧嘴笑", "灿烂笑", "震惊", "紧张", "阴险", "呆住", "鬼脸", "惊恐", "闭嘴", "抓狂", "委屈哭", "心碎", "音符", "礼物", "鲜花"
].map((label, index) => ({ token: `[e${index}]`, label }));

const ICON_LABELS = [
  "微笑", "难过", "生气", "大笑", "害羞", "哭泣", "吐舌", "酷", "喜欢", "图片", "邮件", "警告", "拇指", "文件夹", "信封", "纸张", "声音", "静音", "爱心", "紫心", "黑桃", "梅花", "星星", "游戏手柄", "音符", "叉号", "禁止", "靶心", "眼睛", "向左", "向右", "向上", "向下", "双向箭头", "井号", "减号", "加号", "按钮", "按钮", "按钮", "按钮", "按钮", "向左箭头", "向右箭头", "加号"
].map((label, index) => ({ token: `[ico${index}]`, label }));

const TAOZI_EMOJI_CATALOG = Object.freeze([...EMOJI_LABELS, ...ICON_LABELS]);

function emojiPromptText() {
  return TAOZI_EMOJI_CATALOG.map(({ token, label }) => `${token}=${label}`).join("、");
}

module.exports = { TAOZI_EMOJI_CATALOG, emojiPromptText };
