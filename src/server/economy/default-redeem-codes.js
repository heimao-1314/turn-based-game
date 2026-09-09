const CSLB_CODE_HASH = "5eea6f47627b89e49b7d086c741c03f84cd24448ad825d3b97937b26d9ccbb85";

const DEFAULT_REDEEM_CODES = [{
  codeHash: CSLB_CODE_HASH,
  perAccountLimit: 1,
  rewards: {
    soul_powder: 1000000,
    immortal_pill: 10000,
    yuanbao: 20000,
    silver: 1000000,
    mysterious_paint: 10000,
    phantom_title_first_7d: 1,
    fashion_ticket: 5,
    holy_skill_ticket: 5,
    peerless_skill_ticket: 5,
    peerless_role_skill_ticket: 5,
    peerless_pet_scroll_ticket: 5,
    peerless_holy_weapon_ticket: 5
  }
}];

module.exports = { DEFAULT_REDEEM_CODES };
