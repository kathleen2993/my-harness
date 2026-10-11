// ============================================================
// 의뢰서 CG 제작 - Figma Plugin Main Logic
// ============================================================

figma.showUI(__html__, { width: 640, height: 720, title: "의뢰서 CG 제작" });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "generate-fullcg") {
    fontFailures.length = 0;
    await generateFullCGSlides(msg.slides, {
      bgImageBytes: msg.bgImageBytes || null,
      logoImageBytes: msg.logoImageBytes || null,
      bgColor: msg.bgColor || null,
      templates: msg.templates || null
    });
    // 같은 문서에서 감지된 슬림배너(MobileLive_Banner_Frame 형식) 항목이 있으면 이어서 함께 생성
    if (msg.bannerData && msg.bannerData.length > 0) {
      await generateBannerBundle(msg.bannerData, msg.templates || null);
    }
    reportFontFailures();
  } else if (msg.type === "cancel") {
    figma.closePlugin();
  }
};

function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return null;
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map(c => c + c).join("");
  }
  if (clean.length !== 6) return null;
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return {
    r: isNaN(r) ? 1 : Math.max(0, Math.min(1, r)),
    g: isNaN(g) ? 1 : Math.max(0, Math.min(1, g)),
    b: isNaN(b) ? 1 : Math.max(0, Math.min(1, b))
  };
}

// ============================================================
// 템플릿 컴포넌트 탐색
// ============================================================
// 템플릿 컴포넌트 탐색
// ============================================================
// ============================================================
// 템플릿 탐색 (엄격 모드)
// 1순위: 하네스가 p2_plan.json에 적어 준 컴포넌트 ID로 정확히 찾는다.
// 2순위(ID가 없을 때만): 현재 페이지에서 "이름이 정확히 같은 COMPONENT"만 찾는다.
// 비슷한 이름의 일반 프레임이나 detach된 복사본으로 대체하지 않는다. 못 찾으면 null을 돌려주고,
// 호출하는 쪽에서 에러로 멈춘다.
const TEMPLATE_ROLES = {
  mobileLiveModule: ["#MobileLive-Module"],
  cardPrd: ["#MainCard_Prd"],
  cardChecklist: ["#MainCard_Checklist"],
  cardStory: ["#MainCard_Story"],
  bg: ["#BG"],
  logo: ["Logo", "#Logo"],
  banner: ["PrdList_Frame_1"],
  cardMultiPrd: [],   // 다상품형 (#MainCard_MultiPrd의 Layout=2단 변형) — 이름이 "Layout=2단"이라 ID 지정 필수
  cardGift: ["#MainCard_Gift"],
};

async function findTemplates(page, ids) {
  const isInsideWrapper = (n) => {
    let curr = n.parent;
    while (curr && curr !== page) {
      if (curr.name && (curr.name.includes("전면CG_묶음") || curr.name.includes("슬림배너_묶음"))) return true;
      curr = curr.parent;
    }
    return false;
  };
  const found = {};
  const problems = [];
  for (const [role, names] of Object.entries(TEMPLATE_ROLES)) {
    found[role] = null;
    const id = ids && ids[role];
    if (id) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node) { problems.push(`${role}: ID ${id} 노드를 찾을 수 없음`); continue; }
      if (node.type !== "COMPONENT") { problems.push(`${role}: ID ${id}는 컴포넌트가 아님 (${node.type} "${node.name}")`); continue; }
      found[role] = node;
      continue;
    }
    const matches = page.findAll(n => n.type === "COMPONENT" && names.includes(n.name) && !isInsideWrapper(n));
    if (matches.length === 1) found[role] = matches[0];
    else if (matches.length > 1) problems.push(`${role}: 같은 이름의 컴포넌트가 ${matches.length}개 있어 하나를 고를 수 없음 (p2_plan.json에 ID를 지정하세요)`);
  }
  found.problems = problems;
  return found;
}

// 피그마 컴포넌트 및 베리언트를 절대 깨지(detach) 않고
// 순수 Figma 인스턴스(InstanceNode) 상태를 100% 온전히 유지하여 생성하는 핵심 함수
function createInstanceFromTemplate(templateNode) {
  if (!templateNode || templateNode.type !== "COMPONENT") return null;
  return templateNode.createInstance();
}

function toUint8Array(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  if (typeof data === "object") {
    if (data.buffer && data.buffer instanceof ArrayBuffer) {
      return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length);
    }
    const values = Object.values(data);
    return new Uint8Array(values);
  }
  return null;
}

// ============================================================
// 슬라이드 일괄 생성 메인 (오토레이아웃 래퍼 + 01, 02 넘버링)
// ============================================================
async function generateFullCGSlides(slides, options = {}) {
  const page = figma.currentPage;
  const templates = await findTemplates(page, options.templates);

  // 슬라이드에 필요한 템플릿이 모두 있는지 먼저 확인하고, 하나라도 없으면 아무것도 만들지 않고 멈춘다.
  const needed = new Set(["mobileLiveModule"]);
  for (const sd of slides) {
    if (sd.compType === "#MainCard_Checklist") needed.add("cardChecklist");
    else if (sd.compType === "#MainCard_MultiPrd") needed.add("cardMultiPrd");
    else if (sd.compType === "#MainCard_Gift") needed.add("cardGift");
    else if (sd.compType === "#MainCard_Story") needed.add("cardStory");
    else if (sd.compType === "NONE") { /* 빈 전면: 카드 없음 */ }
    else needed.add("cardPrd");
  }
  const missing = [...needed].filter(r => !templates[r]);
  if (missing.length > 0) {
    figma.ui.postMessage({
      type: "error",
      message: "템플릿 컴포넌트를 찾을 수 없어 생성을 중단했습니다.\n- 없음: " + missing.join(", ") +
        (templates.problems.length ? "\n- 상세: " + templates.problems.join(" / ") : "") +
        "\n템플릿이 있는 페이지에서 실행하거나, p2_plan.json의 templates에 컴포넌트 ID를 지정하세요.",
    });
    return;
  }
  const baseCard = templates.cardPrd || templates.cardChecklist || templates.cardStory || templates.mobileLiveModule;

  try {
    await loadEssentialFonts();
  } catch (e) {
    console.warn("폰트 로딩 경고:", e);
  }

  // 커스텀 이미지 객체 생성 (배경 및 로고)
  const bgBytes = toUint8Array(options.bgImageBytes);
  const logoBytes = toUint8Array(options.logoImageBytes);
  let customBgImgObj = null;
  let customLogoImgObj = null;

  if (bgBytes && bgBytes.length > 0) {
    try {
      customBgImgObj = figma.createImage(bgBytes);
    } catch (e) {
      console.warn("커스텀 배경 이미지 로드 실패:", e);
    }
  }

  if (logoBytes && logoBytes.length > 0) {
    try {
      customLogoImgObj = figma.createImage(logoBytes);
    } catch (e) {
      console.warn("커스텀 로고 이미지 로드 실패:", e);
    }
  }

  const SLIDE_WIDTH = 375;
  const SLIDE_HEIGHT = 667;

  // 375*667 슬라이드들을 감쌀 일괄 가로 오토레이아웃 래퍼 프레임 생성 (간격 50)
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const wrapperFrame = figma.createFrame();
  wrapperFrame.name = `전면CG_묶음_${dateStr}`;

  wrapperFrame.layoutMode = "HORIZONTAL";
  wrapperFrame.itemSpacing = 50;
  wrapperFrame.paddingTop = 0;
  wrapperFrame.paddingBottom = 0;
  wrapperFrame.paddingLeft = 0;
  wrapperFrame.paddingRight = 0;
  wrapperFrame.primaryAxisSizingMode = "AUTO";
  wrapperFrame.counterAxisSizingMode = "AUTO";
  wrapperFrame.fills = [];

  wrapperFrame.x = baseCard.x + baseCard.width + 160;
  wrapperFrame.y = baseCard.y;
  page.appendChild(wrapperFrame);

  const createdSlides = [];

  for (let i = 0; i < slides.length; i++) {
    const slideData = slides[i];

    try {
      const slideNum = String(i + 1).padStart(2, '0');
      let slideFrame = null;

      // 1) 375*667 개체 하나의 프레임을 #MobileLive-Module 기반으로 생성
      // 최상위 슬라이드 묶음 프레임만 개별 슬라이드로 독립 분리하고, 내부의 모든 컴포넌트/베리언트는 100% 인스턴스 상태를 온전히 보존
      if (templates.mobileLiveModule) {
        const moduleInst = templates.mobileLiveModule.createInstance();
        slideFrame = moduleInst.detachInstance();
        slideFrame.name = `${slideNum}_#MobileLive-Module`;
      } else {
        slideFrame = figma.createFrame();
        slideFrame.name = `${slideNum}_#MobileLive-Module`;
        slideFrame.resize(SLIDE_WIDTH, SLIDE_HEIGHT);
        slideFrame.clipsContent = true;
      }

      // A. 배경 (#BG > #Image)
      let bgNode = findNodeByName(slideFrame, "#BG") || findNodeByName(slideFrame, "BG");
      if (!bgNode && templates.bg) {
        bgNode = createInstanceFromTemplate(templates.bg);
        bgNode.x = 0;
        bgNode.y = 0;
        slideFrame.insertChild(0, bgNode);
      }

      // A-1. #BG Fill 단색 색상 적용 (피커 또는 자동 추출된 배경색)
      if (options.bgColor) {
        const rgb = hexToRgb(options.bgColor);
        if (rgb) {
          if (bgNode) {
            bgNode.fills = [{
              type: "SOLID",
              color: rgb
            }];
          }
          slideFrame.fills = [{
            type: "SOLID",
            color: rgb
          }];
        }
      }

      if (bgNode && customBgImgObj) {
        // #BG 내부의 #Image 레이어 정밀 탐색 (사용자 지정: #BG > #Image)
        const bgImgNode = findNodeByName(bgNode, "#Image") ||
                          findNodeByName(bgNode, "Image") ||
                          findNodeByName(bgNode, " Image") ||
                          findNodeByName(bgNode, "#image") ||
                          findNodeByName(bgNode, "image") ||
                          findAllNodesMatching(bgNode, (n) => normalizeName(n.name).includes("image"))[0];
        if (bgImgNode) {
          bgImgNode.visible = true;
          bgImgNode.opacity = 1;
          bgImgNode.fills = [{
            type: "IMAGE",
            scaleMode: "FILL",
            imageHash: customBgImgObj.hash
          }];
          if ("children" in bgImgNode) {
            for (const ch of bgImgNode.children) {
              ch.visible = false;
            }
          }
        } else {
          bgNode.fills = [{
            type: "IMAGE",
            scaleMode: "FILL",
            imageHash: customBgImgObj.hash
          }];
        }
      } else if (customBgImgObj) {
        slideFrame.fills = [{
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash: customBgImgObj.hash
        }];
      }

      // B. 상단 로고 (Logo)
      let logoNode = findNodeByName(slideFrame, "#Logo") || findNodeByName(slideFrame, "Logo");
      if (!logoNode && templates.logo) {
        logoNode = createInstanceFromTemplate(templates.logo);
        logoNode.x = (SLIDE_WIDTH - logoNode.width) / 2;
        logoNode.y = 20;
        slideFrame.appendChild(logoNode);
      }

      if (logoNode && customLogoImgObj) {
        logoNode.visible = true;
        // 기존 기본 템플릿의 "LOGO" 그래픽/텍스트를 모두 숨김
        if ("children" in logoNode) {
          for (const ch of logoNode.children) {
            ch.visible = false;
          }
        }
        logoNode.fills = [{
          type: "IMAGE",
          scaleMode: "FIT",
          imageHash: customLogoImgObj.hash
        }];
      }

      // C. 컴포넌트 타입 매핑 및 카드 배치 (베리언트와 컴포넌트 인스턴스를 절대 깨지 않고 100% 보존)
      let targetTemplate = null;
      if (slideData.compType === "#MainCard_Checklist") {
        targetTemplate = templates.cardChecklist;
      } else if (slideData.compType === "#MainCard_Story") {
        targetTemplate = templates.cardStory;
      } else if (slideData.compType === "#MainCard_MultiPrd") {
        targetTemplate = templates.cardMultiPrd;
      } else if (slideData.compType === "#MainCard_Gift") {
        targetTemplate = templates.cardGift;
      } else if (slideData.compType === "NONE") {
        targetTemplate = null; // 빈 전면
      } else {
        targetTemplate = templates.cardPrd;
      }

      let existingCard = findNodeByName(slideFrame, "#MainCard_Prd") ||
                         findNodeByName(slideFrame, "#MainCard_Story") ||
                         findNodeByName(slideFrame, "#MainCard_Checklist") ||
                         findNodeByName(slideFrame, "#MainCard_Frame") ||
                         findNodeByName(slideFrame, "#MainCard");

      let cardNode = null;
      if (existingCard && targetTemplate && normalizeName(existingCard.name) === normalizeName(targetTemplate.name)) {
        // 이미 해당 컴포넌트 인스턴스가 존재하면 그대로 유지 (베리언트/인스턴스 절대 깨지 않음)
        cardNode = existingCard;
      } else if (targetTemplate) {
        // 새로운 카드 인스턴스 생성 (절대 detach하지 않고 Figma 인스턴스/베리언트 100% 온전히 유지)
        const newCard = createInstanceFromTemplate(targetTemplate);
        newCard.name = (targetTemplate.parent && targetTemplate.parent.type === "COMPONENT_SET") ? targetTemplate.parent.name : targetTemplate.name;
        newCard.x = existingCard ? existingCard.x : (SLIDE_WIDTH - newCard.width) / 2;
        newCard.y = existingCard ? existingCard.y : 74;

        if (existingCard && existingCard.parent) {
          existingCard.parent.insertChild(existingCard.parent.children.indexOf(existingCard), newCard);
          existingCard.remove();
        } else {
          slideFrame.appendChild(newCard);
        }
        cardNode = newCard;
      } else if (slideData.compType === "NONE") {
        // 빈 전면: 기본 카드를 지우고 배경·로고만 남긴다
        if (existingCard) existingCard.remove();
      } else if (existingCard) {
        cardNode = existingCard;
      }

      // D. 컴포넌트별 데이터 채우기
      if (cardNode) {
        if (slideData.compType === "#MainCard_MultiPrd") {
          await fillMultiPrdCard(cardNode, slideData);
        } else if (slideData.compType === "#MainCard_Gift") {
          await fillGiftCard(cardNode, slideData);
        } else if (cardNode.name.includes("Checklist") || slideData.compType === "#MainCard_Checklist") {
          await fillChecklistCard(cardNode, slideData);
        } else if (cardNode.name.includes("Story") || slideData.compType === "#MainCard_Story") {
          await fillStoryCard(cardNode, slideData);
        } else {
          await fillPrdCard(cardNode, slideData);
        }

        // D-1. 카드 내부의 모든 Logo 레이어 전수 탐색 및 사용자 커스텀 로고 적용
        if (customLogoImgObj) {
          const inCardLogos = findAllNodesMatching(cardNode, (n) => {
            const nm = normalizeName(n.name);
            return nm === "logo" || nm === "#logo" || nm.includes("logo");
          });
          for (const cLogo of inCardLogos) {
            if ("children" in cLogo) {
              for (const ch of cLogo.children) {
                ch.visible = false;
              }
            }
            if ((slideData.compType === "#MainCard_Story" && !slideData.showLogo) || slideData.compType === "#MainCard_Gift" || slideData.compType === "#MainCard_MultiPrd") {
              cLogo.visible = false;
            } else {
              cLogo.visible = true;
              cLogo.fills = [{
                type: "IMAGE",
                scaleMode: "FIT",
                imageHash: customLogoImgObj.hash
              }];
            }
          }
        }
      }

      // E. 슬라이드 프레임 전체에 대한 더미(#Check_Main_txt_*) 최종 소탕 (누락 방지)
      // 사은품형은 금액대별 목록(tiers)이 체크리스트 역할을 하므로 그 기준으로 정리한다 (빈 목록으로 보고 끄지 않게)
      const listForCleanup = slideData.compType === "#MainCard_Gift"
        ? (slideData.tiers || []).map(t => (t && t.main) || "")
        : (slideData.listItems || []);
      await cleanupChecklistDummyTexts(slideFrame, listForCleanup);

      wrapperFrame.appendChild(slideFrame);
      createdSlides.push(slideFrame);

      figma.ui.postMessage({
        type: "progress",
        current: i + 1,
        total: slides.length,
      });

    } catch (err) {
      console.error(`슬라이드 ${i + 1} 생성 오류:`, err);
    }
  }

  // 3) 완료 시 375*667 프레임들을 일괄 가로 오토레이아웃으로 패킹 및 포커스
  if (createdSlides.length > 0) {
    wrapperFrame.layoutMode = "HORIZONTAL";
    wrapperFrame.itemSpacing = 50;
    wrapperFrame.paddingTop = 0;
    wrapperFrame.paddingBottom = 0;
    wrapperFrame.paddingLeft = 0;
    wrapperFrame.paddingRight = 0;
    wrapperFrame.primaryAxisSizingMode = "AUTO";
    wrapperFrame.counterAxisSizingMode = "AUTO";
    wrapperFrame.fills = [];

    // 01, 02, 03 순서대로 확실히 배치
    for (const sf of createdSlides) {
      wrapperFrame.appendChild(sf);
    }

    figma.currentPage.selection = [wrapperFrame];
    figma.viewport.scrollAndZoomIntoView([wrapperFrame]);
  }

  figma.ui.postMessage({
    type: "done",
    count: createdSlides.length,
  });
}

// ============================================================
// 컴포넌트 속성(Boolean) 켜고 끄기: 속성 이름 앞부분으로 찾는다 (예: "Item 3", "Gift 2")
// ============================================================
function setBoolProp(instance, propName, value) {
  if (!instance || instance.type !== "INSTANCE") return false;
  const key = Object.keys(instance.componentProperties || {}).find(k => k.split("#")[0] === propName);
  if (!key) return false;
  instance.setProperties({ [key]: Boolean(value) });
  return true;
}

async function fillCardTitle(cardNode, data) {
  const hasTitle = Boolean(data.title && String(data.title).trim()) && data.showTitle !== false;
  setBoolProp(cardNode, "Title", hasTitle);
  if (hasTitle) {
    const tf = cardNode.children.find(c => c.name === "#Title_Frame");
    if (tf) await smartSetText(tf, "#Title_Main Text", String(data.title).trim());
  }
}

// ============================================================
// 다상품형 #MainCard_MultiPrd (Layout=2단): 상품 칸(#Prd_Item_1~3)마다 상품형 채우기를 재사용
// data.items = [{ prdTitle, prdSubTitle, tag1, originalPrice, discountRate, discountPrice, hasImage, ... }, ...]
// ============================================================
async function fillMultiPrdCard(cardNode, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  await fillCardTitle(cardNode, data);
  for (let i = 3; i <= 5; i++) setBoolProp(cardNode, `Item ${i}`, i <= items.length);
  for (let i = 1; i <= items.length; i++) {
    const itemNode = cardNode.findOne(n => n.name === `#Prd_Item_${i}`);
    if (itemNode) await fillPrdCard(itemNode, items[i - 1] || {});
  }
}

// ============================================================
// 사은품형 #MainCard_Gift: 제목 + 사은품 1·2 (대상/사은품명/조건/유의) + 금액대별 목록
// data.gifts = [{ target, name, condition, note, hasImage }], data.tiers = [{ main, sub }]
// ============================================================
async function fillGiftCard(cardNode, data) {
  const gifts = Array.isArray(data.gifts) ? data.gifts : [];
  const tiers = Array.isArray(data.tiers) ? data.tiers : [];
  await fillCardTitle(cardNode, data);
  setBoolProp(cardNode, "Gift 2", gifts.length >= 2);
  setBoolProp(cardNode, "Tier List (금액대별)", tiers.length > 0);
  for (let i = 1; i <= Math.min(2, gifts.length); i++) {
    const g = gifts[i - 1] || {};
    const group = cardNode.findOne(n => n.name === `#Gift_txt_group_${i}`);
    const img = cardNode.findOne(n => n.name === `#Gift_Image_${i}`);
    if (img) img.visible = g.hasImage !== false;
    if (!group) continue;
    const fields = [["Main 1", "#Main_txt_1", g.target], ["Main 2", "#Main_txt_2", g.name], ["Highlight", "#Hightlight_Text", g.condition], ["Sub", "#Sub_Text", g.note]];
    for (const [prop, layer, value] of fields) {
      const has = Boolean(value && String(value).trim());
      setBoolProp(group, prop, has);
      if (has) {
        const t = group.findOne(n => n.type === "TEXT" && n.name === layer);
        if (t) await setText(t, String(value).trim());
      }
    }
  }
  const tierList = cardNode.findOne(n => n.name === "#Gift_Tier_List");
  if (tierList && tiers.length > 0) {
    for (let i = 1; i <= 5; i++) {
      const tier = tiers[i - 1];
      setBoolProp(tierList, `Item ${i}`, Boolean(tier));
      const hasSub = Boolean(tier && tier.sub && String(tier.sub).trim());
      setBoolProp(tierList, `Sub ${i}`, hasSub);
      if (!tier) continue;
      const main = tierList.findOne(n => n.type === "TEXT" && n.name === `#Check_Main_txt_${i}`);
      if (main) await setText(main, String(tier.main || "").trim());
      if (hasSub) {
        const sub = tierList.findOne(n => n.type === "TEXT" && n.name === `#Check_Sub_txt_${i}`);
        if (sub) await setText(sub, String(tier.sub).trim());
      }
    }
  }
}

// ============================================================
// 1. #MainCard_Prd (상품명, 부제목, 태그, 가격 완벽 주입)
// ============================================================
async function fillPrdCard(cardNode, data) {
  // 상단 타이틀 바 숨김
  const titleFrame = findNodeByName(cardNode, "#Title_Frame") || findNodeByName(cardNode, "_Title");
  if (titleFrame) titleFrame.visible = false;

  // 태그 컨테이너 제어 (#Prd_Tag 전체 숨김 보장)
  const hasTag1 = Boolean(data.tag1 && data.tag1.trim());
  const hasTag2 = Boolean(data.tag2 && data.tag2.trim());
  const prdTagGroup = findNodeByName(cardNode, "#Prd_Tag");
  const tag1Node = findNodeByName(cardNode, "Prd_Tag_1") || findNodeByName(cardNode, "#Prd_Tag_1");
  const tag2Node = findNodeByName(cardNode, "Prd_Tag_2") || findNodeByName(cardNode, "#Prd_Tag_2");

  if (!hasTag1 && !hasTag2) {
    if (prdTagGroup) prdTagGroup.visible = false;
    if (tag1Node) tag1Node.visible = false;
    if (tag2Node) tag2Node.visible = false;
  } else {
    if (prdTagGroup) prdTagGroup.visible = true;
    if (tag1Node) {
      tag1Node.visible = hasTag1;
      if (hasTag1) await smartSetText(tag1Node, "#Prd_Tag_1_txt", data.tag1.trim());
    }
    if (tag2Node) {
      tag2Node.visible = hasTag2;
      if (hasTag2) await smartSetText(tag2Node, "#Prd_Tag_2_txt", data.tag2.trim());
    }
  }

  // ── 2) 상품명 텍스트 주입 (#Prd_title 문자열 매칭 보장) ────────
  const prdTitleNode = findTextNodeByPredicate(cardNode, (n) =>
    n.name === "#Prd_Title_txt" ||
    n.name === "#Prd_title" ||
    n.name === "Prd_Title_txt" ||
    n.name === "#PrdTitle" ||
    n.characters === "#Prd_title" ||
    n.characters === "#Prd_Title" ||
    n.characters.trim() === "#Prd_title"
  );
  if (prdTitleNode && data.prdTitle) {
    prdTitleNode.visible = true;
    await setText(prdTitleNode, data.prdTitle.trim());
  }

  // ── 2) 부제목 / 중량 텍스트 주입 (#Prd_SubTitle 매칭 보장) ────
  const prdSubNode = findTextNodeByPredicate(cardNode, (n) =>
    n.name === "#Prd_SubTitle1_txt" ||
    n.name === "#Prd_SubTitle" ||
    n.name === "#Prd_SubTitle_txt" ||
    n.characters === "#Prd_SubTitle" ||
    n.characters === "#Prd_Subtitle" ||
    n.characters.trim() === "#Prd_SubTitle"
  );
  if (prdSubNode) {
    if (data.prdSubTitle && data.prdSubTitle.trim()) {
      prdSubNode.visible = true;
      await setText(prdSubNode, data.prdSubTitle.trim());
    } else {
      prdSubNode.visible = false;
    }
  }

  // 가격 영역 (#Price_Default & #Price_Dual)
  const defaultPrice = findNodeByName(cardNode, "#Price_Default");
  if (defaultPrice) {
    defaultPrice.visible = true;

    // 1차 할인태그 (#Price_Tag)
    const tag1 = findNodeByName(defaultPrice, "#Price_Tag");
    if (data.priceTag1 && !data.priceTag1.includes('%')) {
      if (tag1) tag1.visible = true;
      await smartSetText(tag1 || defaultPrice, "#Price_Tag1_txt", data.priceTag1);
    } else if (tag1) {
      tag1.visible = false;
    }

    // 할인율 (#Price-Discount rate)
    const discountRateVal = data.discountRate || (data.priceTag1 && data.priceTag1.includes('%') ? data.priceTag1 : '');
    const discountRateNode = findTextNodeByPredicate(defaultPrice, n =>
      n.name === "#Price-Discount rate" ||
      n.characters === "#Price-Discount rate" ||
      n.characters.includes("%")
    ) || findTextNodeByPredicate(cardNode, n =>
      n.name === "#Price-Discount rate" ||
      n.characters === "#Price-Discount rate"
    );
    if (discountRateNode) {
      if (discountRateVal && discountRateVal.trim()) {
        discountRateNode.visible = true;
        await setText(discountRateNode, discountRateVal.trim());
      } else {
        discountRateNode.visible = false;
      }
    }

    // 정상가 세트 (#Original-price + #WON_txt)
    setOriginalPriceSet(defaultPrice, data.originalPrice);

    // 할인가 (최종가)
    const discTxtNode = findTextNodeByName(defaultPrice, "#Discounted price_txt") ||
                        findTextNodeByName(defaultPrice, "#Discount_Price_txt");
    if (data.discountPrice && discTxtNode) {
      discTxtNode.visible = true;
      await setText(discTxtNode, cleanPrice(data.discountPrice));
    }
  }

  // 2차 듀얼 가격 (#Price_Dual)
  const dualPrice = findNodeByName(cardNode, "#Price_Dual");
  if (dualPrice) {
    if (data.hasDual || (data.dualDiscountPrice && data.dualDiscountPrice.trim())) {
      dualPrice.visible = true;

      const tag2 = findNodeByName(dualPrice, "#Price_Tag");
      if (data.priceTag2) {
        if (tag2) tag2.visible = true;
        await smartSetText(tag2 || dualPrice, "#Price_Tag1_txt", data.priceTag2);
      } else if (tag2) {
        tag2.visible = false;
      }

      setOriginalPriceSet(dualPrice, null);

      const dualDiscNode = findTextNodeByName(dualPrice, "#Discounted price_txt") ||
                          findTextNodeByName(dualPrice, "#Discount_Price_txt");
      if (dualDiscNode && data.dualDiscountPrice) {
        dualDiscNode.visible = true;
        await setText(dualDiscNode, cleanPrice(data.dualDiscountPrice));
      }
    } else {
      dualPrice.visible = false;
    }
  }

  // #Price_Triple: 템플릿 기본값이 visible=true로 되어 있는데 3차 가격 기능은 아직 지원하지 않으므로
  // 항상 꺼서 안 쓰는 레이어가 노출되지 않도록 한다.
  const triplePrice = findNodeByName(cardNode, "#Price_Triple");
  if (triplePrice) triplePrice.visible = false;

  // 프로모션 제어 (#Promotion 및 #Promotion_txt)
  const promoFrame = findNodeByName(cardNode, "#Promotion");
  if (promoFrame) {
    if (data.promotion && data.promotion.trim()) {
      promoFrame.visible = true;
      const promoTxt = findTextNodeByName(promoFrame, "#Promotion_txt") ||
                       findTextNodeByName(promoFrame, "Promotion_txt") ||
                       findTextNodeByPredicate(promoFrame, n => n.type === "TEXT");
      if (promoTxt) {
        promoTxt.visible = true;
        await setText(promoTxt, data.promotion.trim());
      }
    } else {
      promoFrame.visible = false;
    }
  }

  // 썸네일/이미지 및 옵션명 제어 (#Thumbnail / #Thumbnail_Frame)
  const hasThumb = data.hasImage !== false;
  const thumbGroup = findNodeByName(cardNode, "#Thumbnail") || findNodeByName(cardNode, "#Thumbnail_Frame");
  if (thumbGroup) {
    thumbGroup.visible = hasThumb;
    if (hasThumb) {
      const imgCount = (data.options && data.options.length) || data.imageCount || 1;
      for (let i = 1; i <= 6; i++) {
        const frame = findNodeByName(cardNode, `#Thumbnail_Frame_${i}`);
        if (frame) {
          frame.visible = i <= imgCount;
          if (frame.visible) {
            const rawOpt = (data.options && data.options[i - 1]) ? String(data.options[i - 1]).trim() : "";
            const isCommon = /공통/.test(rawOpt);
            const cleanOpt = rawOpt.replace(/[\(\[\{]?\s*공통\s*[\)\]\}]?/g, "").trim();

            // 1. 옵션명 텍스트 (#Thumbnail_Frame_option_i) 주입
            const optFrame = findNodeByName(frame, `#Thumbnail_Frame_option_${i}`) ||
                             findNodeByName(cardNode, `#Thumbnail_Frame_option_${i}`) ||
                             findNodeByName(frame, `Thumbnail_Frame_option_${i}`);
            if (optFrame) {
              if (cleanOpt) {
                optFrame.visible = true;
                const optTxtNode = optFrame.type === "TEXT" ? optFrame : findTextNodeByPredicate(optFrame, () => true);
                if (optTxtNode) await setText(optTxtNode, cleanOpt);
              } else {
                optFrame.visible = false;
              }
            }

            // 2. #ThumbBadge_Common (공통 배지) 제어
            const badgeCommon = findNodeByName(frame, "#ThumbBadge_Common") ||
                                findNodeByName(frame, "ThumbBadge_Common") ||
                                findNodeByName(frame, `#ThumbBadge_Common_${i}`) ||
                                findNodeByName(cardNode, `#ThumbBadge_Common_${i}`) ||
                                findNodeByName(cardNode, "#ThumbBadge_Common") ||
                                findNodeByPredicate(frame, n => {
                                  const nm = normalizeName(n.name);
                                  return nm.includes("thumbbadge") || nm.includes("badgecommon");
                                });
            if (badgeCommon) {
              // 템플릿마다 #ThumbBadge(부모)/#ThumbBadge_Common(자식)의 기본 hidden 상태가 서로 달라서
              // 자식만 켜고 끄면 부모가 숨겨진 채로 남아 뱃지가 아예 안 보이거나, 반대로 부모가 계속
              // 떠 있어서 안 쓰는 레이어가 노출되는 문제가 있었음. 부모까지 항상 함께 맞춰준다.
              const badgeWrap = badgeCommon.name === "#ThumbBadge" || badgeCommon.name === "ThumbBadge"
                ? badgeCommon
                : (badgeCommon.parent && /thumbbadge/i.test(normalizeName(badgeCommon.parent.name || "")) ? badgeCommon.parent : null);
              if (isCommon) {
                badgeCommon.visible = true;
                if (badgeWrap) badgeWrap.visible = true;
                const badgeTxt = badgeCommon.type === "TEXT" ? badgeCommon : findTextNodeByPredicate(badgeCommon, () => true);
                if (badgeTxt) await setText(badgeTxt, "공통");
              } else {
                badgeCommon.visible = false;
                if (badgeWrap) badgeWrap.visible = false;
              }
            }
          }
        }
      }
    }
  }
}

// 정상가 세트 제어
function setOriginalPriceSet(containerNode, value) {
  const origContainer = findNodeByName(containerNode, "#Original-price") ||
                        findNodeByName(containerNode, "Original-price") ||
                        findNodeByName(containerNode, "#Original_Price");
  const origTxtNode = findTextNodeByName(containerNode, "#Original-price_txt") ||
                      findTextNodeByName(containerNode, "#Original_Price_txt");
  const wonNode = findNodeByName(containerNode, "#WON_txt") || findNodeByName(containerNode, "WON_txt");

  if (value && String(value).trim()) {
    if (origContainer) origContainer.visible = true;
    if (wonNode) wonNode.visible = true;
    if (origTxtNode) {
      origTxtNode.visible = true;
      setText(origTxtNode, cleanPrice(value));
    }
  } else {
    if (origContainer) origContainer.visible = false;
    if (wonNode) wonNode.visible = false;
    if (origTxtNode) origTxtNode.visible = false;
  }
}

// ============================================================
// 2. #MainCard_Checklist (체크리스트형)
// ============================================================
async function fillChecklistCard(cardNode, data) {
  // 상단 타이틀 바
  const titleFrame = findNodeByName(cardNode, "#Title_Frame");
  const hasTitle = Boolean(data.title && String(data.title).trim());
  if (titleFrame) {
    titleFrame.visible = hasTitle;
    if (hasTitle) {
      await smartSetText(cardNode, "#Title_Main Text", data.title.trim());
    }
  }

  // 상단 이미지 (#Check_Image / #Image): 안 쓰면 무조건 숨김, 쓸 때만 켬!
  const checkImg = findNodeByName(cardNode, "#Check_Image") ||
                   findNodeByName(cardNode, "Check_Image") ||
                   findNodeByName(cardNode, "#Image") ||
                   findNodeByName(cardNode, "Image");
  const hasImage = Boolean(data.hasImage || data.imageUrl || data.image);
  if (checkImg) {
    checkImg.visible = hasImage;
    if (hasImage && "children" in checkImg) {
      for (const ch of checkImg.children) ch.visible = true;
    }
  }

  // 체크리스트 컨테이너 및 항목 제어 (최대 5개 항목 지원)
  const checkListContainer = findChecklistContainerFrame(cardNode, "#MainCard_Checklist");
  const rawItems = data.listItems || [];
  const validItems = [];
  for (let i = 0; i < 5; i++) {
    const val = rawItems[i] ? String(rawItems[i]).trim() : "";
    validItems.push(val);
  }
  const hasAnyItem = validItems.some(it => it.length > 0);

  if (!hasAnyItem) {
    // 내용이 없으면 체크리스트 컨테이너 프레임(#Check List_frame 등)을 완전히 꺼줌
    const allContainers = findAllNodesMatching(cardNode, (n) => {
      const norm = normalizeName(n.name);
      return (norm.includes("checklist") || norm.includes("check_list")) && !norm.includes("txt") && !norm.includes("maincard");
    });
    for (const c of allContainers) {
      c.visible = false;
    }
    if (checkListContainer) checkListContainer.visible = false;
    for (let i = 1; i <= 5; i++) {
      const rowFrame = findChecklistRowFrame(cardNode, i);
      if (rowFrame) rowFrame.visible = false;
    }
  } else {
    // 내용이 있으면 컨테이너 켬!
    if (checkListContainer) checkListContainer.visible = true;

    for (let i = 1; i <= 5; i++) {
      let rowFrame = findChecklistRowFrame(cardNode, i);
      const val = validItems[i - 1];

      if (val && val.length > 0) {
        // 행이 없을 경우 이전 행 복제(clone) 시도
        if (!rowFrame && i > 1) {
          const prevRow = findChecklistRowFrame(cardNode, i - 1);
          if (prevRow && prevRow.parent && "appendChild" in prevRow.parent) {
            try {
              rowFrame = createInstanceFromTemplate(prevRow);
              rowFrame.name = `#Check List_frame_${i}`;
              prevRow.parent.appendChild(rowFrame);
            } catch (e) {
              console.warn("체크리스트 행 복제 추가 실패:", e);
            }
          }
        }

        if (rowFrame) {
          rowFrame.visible = true;
          if ("children" in rowFrame) {
            for (const ch of rowFrame.children) {
              ch.visible = true;
            }
          }
        }

        // 서브 텍스트 처리 (#Check_Sub_txt_${i})
        let subTextVal = (data.listSubTexts && data.listSubTexts[i - 1]) ||
                         (i === 1 ? (data.listSubText1 || (data.listSubTexts && data.listSubTexts[0])) : null) ||
                         (i === 2 ? (data.listSubText2 || data.listSubText || (data.listSubTexts && data.listSubTexts[1])) : null) ||
                         (data[`listSubText${i}`] || null) ||
                         "";

        let mainTextVal = val;
        // 괄호 포함 시 스마트 분리 (예: "10% 쿠폰 (5만원 이상)" -> 메인: "10% 쿠폰", 서브: "(5만원 이상)")
        if (!subTextVal && val) {
          const parenMatch = val.match(/^(.*?)\s*(\([^\)]+\))$/);
          if (parenMatch) {
            mainTextVal = parenMatch[1].trim();
            subTextVal = parenMatch[2].trim();
          }
        }

        // 메인 텍스트 노드 탐색 (rowFrame 내부 및 cardNode 전체 정밀 검색)
        let targetTextNode = findChecklistMainTextNode(rowFrame, i) ||
                             findChecklistMainTextNode(cardNode, i) ||
                             findTextNodeByName(cardNode, `#Check_Main_txt_${i}`) ||
                             findTextNodeByName(cardNode, `Check_Main_txt_${i}`) ||
                             findTextNodeByPredicate(cardNode, (n) => {
                               const c = n.characters.trim();
                               return c === `#Check_Main_txt_${i}` || c.includes(`Check_Main_txt_${i}`);
                             });

        if (targetTextNode) {
          targetTextNode.visible = true;
          await setText(targetTextNode, mainTextVal);
        } else {
          await smartSetText(rowFrame || cardNode, `#Check_Main_txt_${i}`, mainTextVal);
        }

        // 서브 텍스트 노드 탐색, 조상 프레임 일괄 활성화 및 주입 (#Check_Sub_txt_${i})
        await setChecklistSubText(cardNode, rowFrame, i, subTextVal);
      } else {
        // 내용이 없으면 해당 행 및 오토레이아웃 프레임을 확실하게 꺼줌!
        hideChecklistRow(cardNode, i);
      }
    }
  }

  // 잔존 더미 텍스트(#Check_Main_txt_*) 최종 소탕 (화면에 더미가 노출되는 현상 100% 방지)
  await cleanupChecklistDummyTexts(cardNode, validItems);
}

// ============================================================
// 3. #MainCard_Story (텍스트 및 체크리스트, 이미지 동적 On/Off)
// ============================================================
async function fillStoryCard(cardNode, data) {
  // 상단 타이틀 바 숨김
  const titleFrame = findNodeByName(cardNode, "#Title_Frame");
  if (titleFrame) titleFrame.visible = false;

  // #Main_txt_1: 텍스트가 있으면 켜고, 없으면 끔
  const main1Node = findTextNodeByName(cardNode, "#Main_txt_1");
  const hasMain1 = Boolean(data.storyMain1 && String(data.storyMain1).trim());
  if (main1Node) {
    main1Node.visible = hasMain1;
    if (hasMain1) {
      await setText(main1Node, data.storyMain1.trim());
    }
  }

  // #logo: 노출 여부에 따라 켜고 끔
  const logoNode = findNodeByName(cardNode, "#logo") || findNodeByName(cardNode, "Logo") || findNodeByName(cardNode, "logo");
  if (logoNode) {
    logoNode.visible = Boolean(data.showLogo);
  }

  // #Main_txt_2: 텍스트가 있으면 켜고, 없으면 끔
  const main2Node = findTextNodeByName(cardNode, "#Main_txt_2");
  const hasMain2 = Boolean(data.storyMain2 && String(data.storyMain2).trim());
  if (main2Node) {
    main2Node.visible = hasMain2;
    if (hasMain2) {
      await setText(main2Node, data.storyMain2.trim());
    }
  }

  // #Hightlight_Text: 텍스트가 있으면 켜고, 없으면 끔
  const hlContainer = findNodeByName(cardNode, "#Hightlight_Text");
  const hasHl = Boolean(data.highlightText && String(data.highlightText).trim());
  if (hlContainer) {
    hlContainer.visible = hasHl;
    if (hasHl) {
      await smartSetText(hlContainer, "#Hightlight_Text", data.highlightText.trim());
    }
  }

  // #Sub_Text: 텍스트가 있으면 켜고, 없으면 끔
  const subNode = findTextNodeByName(cardNode, "#Sub_Text");
  const hasSub = Boolean(data.storySub && String(data.storySub).trim());
  if (subNode) {
    subNode.visible = hasSub;
    if (hasSub) {
      await setText(subNode, data.storySub.trim());
    }
  }

  // #Main_txt_group 오토레이아웃 컨테이너 노드 제어
  const mainTxtGroup = findNodeByName(cardNode, "#Main_txt_group") || findNodeByName(cardNode, "Main_txt_group");
  const hasAnyMainTxt = Boolean(hasMain1 || hasMain2 || hasHl || hasSub || data.showLogo);
  if (mainTxtGroup) {
    mainTxtGroup.visible = hasAnyMainTxt;
  }

  // 중간 이미지 (#Check_Image / #Image): 안 쓰면 무조건 숨김, 쓸 때만 켬!
  const storyImg = findNodeByName(cardNode, "#Check_Image") ||
                   findNodeByName(cardNode, "Check_Image") ||
                   findNodeByName(cardNode, "#Image") ||
                   findNodeByName(cardNode, "Image");
  const hasImage = Boolean(data.hasImage || data.imageUrl || data.image);
  if (storyImg) {
    storyImg.visible = hasImage;
    if (hasImage && "children" in storyImg) {
      for (const ch of storyImg.children) ch.visible = true;
    }
  }

  // 체크리스트 컨테이너 및 개별 행 제어 (최대 5개 항목 지원)
  const rawItems = data.listItems || [];
  const validItems = [];
  for (let i = 0; i < 5; i++) {
    const val = rawItems[i] ? String(rawItems[i]).trim() : "";
    validItems.push(val);
  }

  // 1) 핵심 조건: #Check_Main_txt_1 (첫 번째 항목)에 텍스트가 안 들어가거나 전체 항목이 비어있으면 #Story_Check List_frame 자체를 완전히 꺼줌!
  const hasFirstItem = Boolean(validItems[0] && validItems[0].length > 0);
  const hasAnyItem = validItems.some((it) => Boolean(it && it.length > 0));
  const checklistFrame = findChecklistContainerFrame(cardNode, "#MainCard_Story");

  if (!hasFirstItem || !hasAnyItem) {
    // #Check_Main_txt_1에 텍스트가 없으면 #Story_Check List_frame 오토레이아웃 프레임 전체를 꺼줌!
    const allContainers = findAllNodesMatching(cardNode, (n) => {
      const norm = normalizeName(n.name);
      return (norm.includes("checklist") || norm.includes("check_list")) && !norm.includes("txt") && !norm.includes("maincard");
    });
    for (const c of allContainers) {
      c.visible = false;
    }
    if (checklistFrame) checklistFrame.visible = false;

    // 모든 개별 행(1~5번)도 빠짐없이 전부 꺼줌!
    for (let i = 1; i <= 5; i++) {
      const rowFrame = findChecklistRowFrame(cardNode, i);
      if (rowFrame) rowFrame.visible = false;
    }
  } else {
    // #Check_Main_txt_1에 텍스트가 있으면 #Story_Check List_frame 오토레이아웃 켬!
    if (checklistFrame) checklistFrame.visible = true;

    for (let i = 1; i <= 5; i++) {
      let rowFrame = findChecklistRowFrame(cardNode, i);
      const val = validItems[i - 1];

      if (val && val.length > 0) {
        if (!rowFrame && i > 1) {
          const prevRow = findChecklistRowFrame(cardNode, i - 1);
          if (prevRow && prevRow.parent && "appendChild" in prevRow.parent) {
            try {
              rowFrame = createInstanceFromTemplate(prevRow);
              rowFrame.name = `#Check List_frame_${i}`;
              prevRow.parent.appendChild(rowFrame);
            } catch (e) {
              console.warn("스토리 행 복제 추가 실패:", e);
            }
          }
        }

        if (rowFrame) {
          rowFrame.visible = true;
          if ("children" in rowFrame) {
            for (const ch of rowFrame.children) {
              ch.visible = true;
            }
          }
        }

        // 서브 텍스트 처리 (#Check_Sub_txt_${i})
        let subTextVal = (data.listSubTexts && data.listSubTexts[i - 1]) ||
                         (i === 1 ? (data.listSubText1 || (data.listSubTexts && data.listSubTexts[0])) : null) ||
                         (i === 2 ? (data.listSubText2 || data.listSubText || (data.listSubTexts && data.listSubTexts[1])) : null) ||
                         (data[`listSubText${i}`] || null) ||
                         "";

        let mainTextVal = val;
        // 괄호 포함 시 스마트 분리 (예: "10% 쿠폰 (5만원 이상)" -> 메인: "10% 쿠폰", 서브: "(5만원 이상)")
        if (!subTextVal && val) {
          const parenMatch = val.match(/^(.*?)\s*(\([^\)]+\))$/);
          if (parenMatch) {
            mainTextVal = parenMatch[1].trim();
            subTextVal = parenMatch[2].trim();
          }
        }

        // 텍스트 노드 탐색 (rowFrame 내부 및 cardNode 전체 정밀 검색)
        let targetTextNode = findChecklistMainTextNode(rowFrame, i) ||
                             findChecklistMainTextNode(cardNode, i) ||
                             findTextNodeByName(cardNode, `#Check_Main_txt_${i}`) ||
                             findTextNodeByName(cardNode, `Check_Main_txt_${i}`) ||
                             findTextNodeByPredicate(cardNode, (n) => {
                               const c = n.characters.trim();
                               return c === `#Check_Main_txt_${i}` || c.includes(`Check_Main_txt_${i}`);
                             });

        if (targetTextNode) {
          targetTextNode.visible = true;
          await setText(targetTextNode, mainTextVal);
        } else {
          await smartSetText(rowFrame || cardNode, `#Check_Main_txt_${i}`, mainTextVal);
        }

        // 서브 텍스트 노드 탐색, 조상 프레임 일괄 활성화 및 주입 (#Check_Sub_txt_${i})
        await setChecklistSubText(cardNode, rowFrame, i, subTextVal);
      } else {
        // 내용이 없으면 해당 행 및 오토레이아웃 프레임을 확실하게 꺼줌!
        hideChecklistRow(cardNode, i);
      }
    }
  }

  // 잔존 더미 텍스트(#Check_Main_txt_*) 최종 소탕
  await cleanupChecklistDummyTexts(cardNode, validItems);
}

// ============================================================
// 체크리스트 서브 텍스트 (#Check_Sub_txt_1~5) 전용 강력 주입 & 활성화 함수
// ============================================================
async function setChecklistSubText(cardNode, rowFrame, index, textValue) {
  const hasVal = Boolean(textValue && String(textValue).trim().length > 0);
  const cleanVal = hasVal ? String(textValue).trim() : "";

  // 1) rowFrame이 유효한 경우, rowFrame 내부에서 먼저 탐색 (행 1, 2, 3, 4, 5 공통 대응)
  let subNodes = [];
  if (rowFrame) {
    subNodes = findAllNodesMatching(rowFrame, (n) => {
      const norm = normalizeName(n.name);
      return norm === `checksubtxt${index}` ||
             norm === `checksubtxt` ||
             norm === `checksub${index}` ||
             norm === `checksub` ||
             norm.includes(`subtxt${index}`) ||
             norm.includes(`sub_txt_${index}`) ||
             norm.includes(`subtxt`) ||
             norm.includes(`sub_txt`) ||
             norm === `sub`;
    });
  }

  // 2) rowFrame 내부에서 못 찾았거나 rowFrame이 없으면 cardNode 전체에서 인덱스 특정 검색
  if (subNodes.length === 0 && cardNode) {
    subNodes = findAllNodesMatching(cardNode, (n) => {
      const norm = normalizeName(n.name);
      return norm === `checksubtxt${index}` ||
             norm === `checksub${index}` ||
             norm.includes(`subtxt${index}`) ||
             norm.includes(`sub_txt_${index}`);
    });
  }

  if (!hasVal) {
    // 서브텍스트가 없으면 해당 행의 모든 서브텍스트 프레임/노드를 완전히 숨김
    for (const node of subNodes) {
      node.visible = false;
    }
    return;
  }

  // 3) 서브텍스트가 있으면 매칭된 모든 프레임을 빠짐없이 visible = true로 켬!
  for (const node of subNodes) {
    node.visible = true;
    if ("children" in node) {
      for (const ch of node.children) {
        ch.visible = true;
      }
    }
  }

  // 4) TEXT 타입 노드 찾기
  let textNode = subNodes.find((n) => n.type === "TEXT");
  if (!textNode) {
    for (const node of subNodes) {
      const tn = findTextChild(node);
      if (tn) {
        textNode = tn;
        break;
      }
    }
  }

  // 5) 텍스트 characters에 더미가 들어있는 경우도 탐색
  if (!textNode && rowFrame) {
    textNode = findTextNodeByPredicate(rowFrame, (n) => {
      const c = n.characters.trim();
      return c.includes(`Check_Sub_txt_${index}`) ||
             c.includes(`Check_Sub_txt`) ||
             c.includes(`Check_Sub`) ||
             c.includes(`#Check_Sub`);
    });
  }
  if (!textNode && cardNode) {
    textNode = findTextNodeByPredicate(cardNode, (n) => {
      const c = n.characters.trim();
      return c.includes(`Check_Sub_txt_${index}`) ||
             c === `#Check_Sub_txt_${index}`;
    });
  }

  // 6) 만약 rowFrame에 서브텍스트 노드가 아예 없고, rowFrame이 일반 Frame인 경우 이전 행에서 복제 시도
  if (!textNode && rowFrame && (rowFrame.type === "FRAME" || rowFrame.type === "GROUP") && cardNode) {
    try {
      const templateSub = findNodeByName(cardNode, "#Check_Sub_txt_1") ||
                          findNodeByName(cardNode, "#Check_Sub_txt_2") ||
                          findNodeByName(cardNode, "#Check_Sub_txt");
      if (templateSub) {
        const clone = templateSub.clone();
        clone.name = `#Check_Sub_txt_${index}`;
        clone.visible = true;
        rowFrame.appendChild(clone);
        textNode = clone.type === "TEXT" ? clone : findTextChild(clone);
      }
    } catch (e) {
      console.warn("서브텍스트 복제 실패:", e);
    }
  }

  if (textNode) {
    // 7) 텍스트 노드의 모든 상위 부모 체인을 cardNode까지 빠짐없이 visible = true 처리
    let curr = textNode;
    const boundary = cardNode || rowFrame;
    while (curr && curr !== boundary) {
      curr.visible = true;
      curr = curr.parent;
    }
    textNode.visible = true;
    await setText(textNode, cleanVal);
  } else if (rowFrame || cardNode) {
    await smartSetText(rowFrame || cardNode, `#Check_Sub_txt_${index}`, cleanVal);
  }
}

// 개별 체크리스트 행 및 오토레이아웃 프레임을 확실히 꺼주는 함수
function hideChecklistRow(cardNode, index) {
  if (!cardNode) return;

  // 1) 컨테이너 프레임 내 index - 1 번째 자식 프레임 끄기
  const containers = [
    findChecklistContainerFrame(cardNode, "#MainCard_Story"),
    findChecklistContainerFrame(cardNode, "#MainCard_Checklist"),
    findChecklistContainerFrame(cardNode)
  ].filter(Boolean);

  const seenContainers = new Set();
  for (const c of containers) {
    if (seenContainers.has(c.id)) continue;
    seenContainers.add(c.id);
    if (c.children && c.children.length >= index) {
      const child = c.children[index - 1];
      if (child && child.type !== "TEXT") {
        child.visible = false;
      }
    }
  }

  // 2) 행 프레임 탐색 및 끄기 (피그마 오토레이아웃 축소)
  const names = [
    `#Check List_frame_${index}`,
    `#CheckList_frame_${index}`,
    `#Check_List_frame_${index}`,
    `Check List_frame_${index}`,
    `CheckList_frame_${index}`,
    `#Check List_Frame_${index}`,
    `Check List_Frame_${index}`,
    `#Check_List_${index}`,
    `Check_List_${index}`,
    `#CheckList_${index}`,
    `CheckList_${index}`,
    `#Check_${index}`,
    `Check_${index}`,
    `#Check_frame_${index}`,
    `Check_frame_${index}`
  ];
  for (const name of names) {
    const nodes = findAllNodesMatching(cardNode, (n) => n.name === name && n.type !== "TEXT");
    for (const n of nodes) {
      n.visible = false;
    }
  }

  // 정규화 탐색으로 프레임 숨김
  const matchingFrames = findAllNodesMatching(cardNode, (n) => {
    if (n.type === "TEXT") return false;
    const norm = normalizeName(n.name);
    return norm === `checklistframe${index}` ||
           norm === `checklist${index}` ||
           norm === `checkframe${index}` ||
           norm === `check${index}` ||
           norm === `checkitem${index}`;
  });
  for (const mf of matchingFrames) {
    mf.visible = false;
  }

  // 3) 해당 행의 텍스트 노드(#Check_Main_txt_${index}, #Check_Sub_txt_${index}) 숨김
  const matchingTexts = findAllNodesMatching(cardNode, (n) => {
    const norm = normalizeName(n.name);
    return norm === `checkmaintxt${index}` ||
           norm === `checksubtxt${index}` ||
           norm.startsWith(`checkmaintxt${index}`) ||
           norm.startsWith(`checksubtxt${index}`);
  });
  for (const mt of matchingTexts) {
    mt.visible = false;
    if (mt.parent && mt.parent !== cardNode && (mt.parent.name.includes(`_${index}`) || mt.parent.name.includes("Check_Sub"))) {
      mt.parent.visible = false;
    }
  }
}

// 잔존 더미 텍스트(#Check_Main_txt_*, #Check_Sub_txt_*) 소탕 함수
async function cleanupChecklistDummyTexts(rootNode, listItems) {
  if (!rootNode) return;
  const rawItems = listItems || [];
  const validItems = [];
  for (let i = 0; i < 5; i++) {
    validItems.push(rawItems[i] ? String(rawItems[i]).trim() : "");
  }

  const hasAnyItem = validItems.some((it) => Boolean(it && it.length > 0));
  if (!hasAnyItem) {
    const allContainers = findAllNodesMatching(rootNode, (n) => {
      const norm = normalizeName(n.name);
      return (norm.includes("checklist") || norm.includes("check_list") || (norm.includes("check") && norm.includes("story"))) && !norm.includes("txt") && !norm.includes("maincard");
    });
    for (const c of allContainers) {
      c.visible = false;
    }
  }

  // 내용이 없는 행은 오토레이아웃 프레임을 확실히 꺼줌
  for (let i = 1; i <= 5; i++) {
    const val = validItems[i - 1];
    if (!val || val.length === 0) {
      hideChecklistRow(rootNode, i);
    }
  }

  // 1) characters에 Check_Main_txt가 포함된 모든 텍스트 노드 탐색
  const dummyNodes = findAllNodesMatching(rootNode, (n) =>
    n.type === "TEXT" && n.characters && (n.characters.includes("Check_Main_txt") || n.characters.includes("#Check_Main"))
  );

  for (const tn of dummyNodes) {
    const match = tn.characters.match(/Check_Main_txt_?(\d+)?/i);
    let idx = 1;
    if (match && match[1]) {
      idx = parseInt(match[1], 10);
    }
    const val = validItems[idx - 1];
    if (val && val.length > 0) {
      await setText(tn, val);
    } else {
      tn.visible = false;
      if (tn.parent && tn.parent !== rootNode && tn.parent.name && tn.parent.name.includes("Check")) {
        tn.parent.visible = false;
      }
    }
  }

  // 2) name이 Check_Main_txt_* 인 텍스트 노드 전수 점검
  for (let i = 1; i <= 5; i++) {
    const val = validItems[i - 1];
    const nodesByName = findAllNodesMatching(rootNode, (n) =>
      n.type === "TEXT" && (n.name === `#Check_Main_txt_${i}` || n.name === `Check_Main_txt_${i}` || normalizeName(n.name) === `checkmaintxt${i}`)
    );
    for (const tn of nodesByName) {
      if (val && val.length > 0) {
        if (tn.characters.includes("Check_Main_txt") || tn.characters.includes("#Check_Main")) {
          await setText(tn, val);
        }
      } else if (tn.characters.includes("Check_Main_txt") || tn.characters.includes("#Check_Main")) {
        tn.visible = false;
      }
    }
  }

  // 3) 잔존 #Check_Sub_txt 더미 텍스트 정리 (템플릿 원본 텍스트가 그대로 남아있는 경우 숨김)
  const dummySubNodes = findAllNodesMatching(rootNode, (n) =>
    n.type === "TEXT" && n.characters && (n.characters.includes("Check_Sub_txt") || n.characters.includes("#Check_Sub"))
  );
  for (const sn of dummySubNodes) {
    sn.visible = false;
    if (sn.parent && sn.parent !== rootNode && sn.parent.name && sn.parent.name.includes("Check_Sub")) {
      sn.parent.visible = false;
      if (sn.parent.parent && sn.parent.parent !== rootNode && sn.parent.parent.name && sn.parent.parent.name.includes("Check_Sub")) {
        sn.parent.parent.visible = false;
      }
    }
  }
}

// ============================================================
// 체크리스트 전용 정밀 탐색 헬퍼
// ============================================================
function findChecklistContainerFrame(cardNode, cardType) {
  const names = [
    "#Story_Check List_frame",
    "#Story_CheckList_frame",
    "#Story_Check_List_frame",
    "Story_Check List_frame",
    "Story_CheckList_frame",
    "#Story_Check List",
    "#Story_CheckList",
    "#Check List_frame",
    "#CheckList_frame",
    "#Check_List_frame",
    "Check List_frame",
    "CheckList_frame"
  ];

  for (const name of names) {
    const found = findNodeByName(cardNode, name);
    if (found) return found;
  }

  // 정규화 탐색
  const allMatches = findAllNodesMatching(cardNode, (n) => {
    const norm = normalizeName(n.name);
    if (norm.includes('txt') || norm.includes('maincard')) return false;
    if (cardType === "#MainCard_Story") {
      return norm.includes('storychecklist') || (norm.includes('story') && norm.includes('check')) || norm === 'checklistframe';
    }
    return norm === 'checklistframe' || (norm.includes('checklistframe') && !norm.includes('frame1') && !norm.includes('frame2') && !norm.includes('frame3') && !norm.includes('frame4') && !norm.includes('frame5'));
  });

  return allMatches.length > 0 ? allMatches[0] : null;
}

function findChecklistRowFrame(cardNode, index) {
  if (!cardNode) return null;
  const names = [
    `#Check List_frame_${index}`,
    `#CheckList_frame_${index}`,
    `#Check_List_frame_${index}`,
    `Check List_frame_${index}`,
    `CheckList_frame_${index}`,
    `#Check List_Frame_${index}`,
    `Check List_Frame_${index}`,
    `#Check_List_${index}`,
    `Check_List_${index}`,
    `#CheckList_${index}`,
    `CheckList_${index}`,
    `#Check_${index}`,
    `Check_${index}`,
    `#Check_frame_${index}`,
    `Check_frame_${index}`
  ];

  for (const name of names) {
    const found = findNodeByName(cardNode, name);
    if (found && found.type !== "TEXT") return found;
  }

  // 정규화 유연 탐색 (텍스트 제외)
  const allNodes = findAllNodesMatching(cardNode, (n) => {
    if (n.type === "TEXT") return false;
    const norm = normalizeName(n.name);
    return norm === `checklistframe${index}` ||
           norm === `checklist${index}` ||
           norm === `checkframe${index}` ||
           norm === `check${index}` ||
           norm === `checkitem${index}`;
  });
  if (allNodes.length > 0) return allNodes[0];

  // 컨테이너 프레임의 자식 순서(index - 1)로 탐색
  const container = findChecklistContainerFrame(cardNode, "#MainCard_Story") || findChecklistContainerFrame(cardNode);
  if (container && container.children && container.children.length >= index) {
    const candidate = container.children[index - 1];
    if (candidate && candidate.type !== "TEXT") return candidate;
  }

  return null;
}

// 개별 행 내부의 메인 텍스트 노드를 100% 찾아내는 함수
function findChecklistMainTextNode(containerNode, index) {
  if (!containerNode) return null;

  // 1) 텍스트 노드 중 내용(characters)에 #Check_Main_txt 또는 Check_Main이 포함된 노드
  const textByChars = findTextNodeByPredicate(containerNode, (n) => {
    const c = n.characters.trim();
    return c === `#Check_Main_txt_${index}` ||
           c.includes(`Check_Main_txt_${index}`) ||
           c.includes("#Check_Main_txt") ||
           c.includes("Check_Main_txt") ||
           c.includes("#Check_Main") ||
           c.includes("Check_Main");
  });
  if (textByChars) return textByChars;

  // 2) 텍스트 노드 중 이름(name)에 Check_Main_txt_${index} 또는 Check_Main이 포함된 노드
  const textByName = findTextNodeByPredicate(containerNode, (n) => {
    const norm = normalizeName(n.name);
    return norm.includes(`checkmaintxt${index}`) || norm.includes('checkmaintxt') || norm.includes('maintext');
  });
  if (textByName) return textByName;

  // 3) #Check_Main_txt_${index} 프레임 내부의 TEXT 자식 노드
  const frameNode = findNodeByName(containerNode, `#Check_Main_txt_${index}`) ||
                    findNodeByName(containerNode, `Check_Main_txt_${index}`) ||
                    findNodeByName(containerNode, `#Check_Main_txt`) ||
                    findNodeByName(containerNode, `Check_Main_txt`);
  if (frameNode) {
    if (frameNode.type === "TEXT") return frameNode;
    const textChild = findTextChild(frameNode);
    if (textChild) return textChild;
  }

  // 4) containerNode 내부의 모든 TEXT 노드 중 서브텍스트(#Check_Sub)가 아닌 첫 번째 TEXT 노드
  const allTexts = findAllNodesMatching(containerNode, (n) => n.type === "TEXT");
  const mainTexts = allTexts.filter(n => {
    const norm = normalizeName(n.name);
    const parentNorm = n.parent ? normalizeName(n.parent.name) : "";
    return !norm.includes("sub") && !parentNorm.includes("sub");
  });
  if (mainTexts.length > 0) return mainTexts[0];

  return null;
}

// ============================================================
// 텍스트 및 노드 탐색 핵심 헬퍼 (유연한 정규화 매칭 지원)
// ============================================================
function normalizeName(str) {
  if (!str) return "";
  return String(str).replace(/[\s_#\-]/g, "").toLowerCase();
}

function findTextNodeByName(root, name) {
  if (root.name === name && root.type === "TEXT") return root;
  if (normalizeName(root.name) === normalizeName(name) && root.type === "TEXT") return root;
  if ("children" in root) {
    for (const child of root.children) {
      const found = findTextNodeByName(child, name);
      if (found) return found;
    }
  }
  return null;
}

function findTextNodeByPredicate(root, predicate) {
  if (root.type === "TEXT" && predicate(root)) return root;
  if ("children" in root) {
    for (const child of root.children) {
      const found = findTextNodeByPredicate(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

async function smartSetText(rootNode, nodeName, value) {
  if (!value || !String(value).trim()) return false;

  let textNode = findTextNodeByName(rootNode, nodeName);
  if (!textNode) {
    const frameNode = findNodeByName(rootNode, nodeName);
    if (frameNode) {
      if (frameNode.type === "TEXT") textNode = frameNode;
      else textNode = findTextChild(frameNode);
    }
  }

  if (textNode) {
    textNode.visible = true;
    await setText(textNode, value);
    return true;
  }
  return false;
}

function findNodeByName(root, name) {
  if (root.name === name) return root;
  if (normalizeName(root.name) === normalizeName(name)) return root;
  if ("children" in root) {
    for (const child of root.children) {
      const found = findNodeByName(child, name);
      if (found) return found;
    }
  }
  return null;
}

function findAllNodesMatching(root, predicate) {
  const matches = [];
  if (predicate(root)) matches.push(root);
  if ("children" in root) {
    for (const child of root.children) {
      matches.push(...findAllNodesMatching(child, predicate));
    }
  }
  return matches;
}

function findTextChild(root) {
  if (root.type === "TEXT") return root;
  if ("children" in root) {
    for (const child of root.children) {
      const found = findTextChild(child);
      if (found) return found;
    }
  }
  return null;
}

function cleanPrice(val) {
  if (!val) return "";
  const m = String(val).match(/[\d,]+/);
  return m ? m[0] : "";
}

async function setText(textNode, value) {
  if (!textNode || textNode.type !== "TEXT") return;
  if (!value || !String(value).trim()) {
    textNode.visible = false;
    return;
  }
  textNode.visible = true;

  const strVal = String(value);
  let fontLoaded = false;

  // 1. 현재 노드의 기존 폰트 로드 시도 (Missing font 검사)
  if (!textNode.hasMissingFont) {
    try {
      if (textNode.fontName !== figma.mixed) {
        await figma.loadFontAsync(textNode.fontName);
        fontLoaded = true;
      } else {
        const segments = textNode.getStyledTextSegments(['fontName']);
        for (const seg of segments) {
          await figma.loadFontAsync(seg.fontName);
        }
        fontLoaded = true;
      }
    } catch (err) {
      fontLoaded = false;
    }
  }

  // 2. 폰트를 불러오지 못하면 다른 폰트로 바꾸지 않는다. 글자를 넣지 않고 실패 목록에 기록한다.
  //    (더미 글자가 그대로 남으므로 하네스 게이트2의 dummy_text / font_substituted 검사에서 걸린다.)
  if (!fontLoaded) {
    const fn = textNode.fontName === figma.mixed ? "혼합 폰트" : `${textNode.fontName.family} ${textNode.fontName.style}`;
    fontFailures.push({ layer: textNode.name, font: fn, value: strVal });
    return;
  }

  // 3. 텍스트 문자열 주입
  try {
    textNode.characters = strVal;
  } catch (err) {
    fontFailures.push({ layer: textNode.name, font: "입력 오류", value: strVal, error: String(err && err.message || err) });
  }
}

// 폰트 문제로 글자를 넣지 못한 칸 목록 (실행마다 초기화)
const fontFailures = [];

function reportFontFailures() {
  if (fontFailures.length === 0) return;
  const fonts = [...new Set(fontFailures.map(f => f.font))];
  figma.ui.postMessage({
    type: "font-report",
    count: fontFailures.length,
    fonts,
    items: fontFailures.slice(0, 50),
  });
}

async function loadEssentialFonts() {
  const styles = ["Bold", "SemiBold", "Regular", "Medium"];
  for (const style of styles) {
    try { await figma.loadFontAsync({ family: "Pretendard", style }); } catch (e) {}
    try { await figma.loadFontAsync({ family: "Pretendard Variable", style }); } catch (e) {}
  }
}

// ============================================================
// 슬림배너 일괄 생성 (MobileLive_Banner_Frame 플러그인의 생성 로직을 이식)
// 같은 의뢰서 안에 "상단 슬림전면/슬림배너" 구간이 있을 때, 전면 CG 슬라이드와
// 한 번의 "생성하기" 클릭으로 함께 만든다. (피그마 플러그인은 서로 직접 호출할 수 없어서
// 로직 자체를 이 파일 안으로 옮겨왔다.)
// ============================================================
const BANNER_LAYER_NAMES = {
  TAG1: "#Prd_Tag_1_txt",
  TAG2: "#Prd_Tag_2_txt",
  TITLE: "#Prd_Title_txt",
  SUBTITLE: "#Prd_SubTitle1_txt",
  PRICE_TAG: "#Price_Tag1_txt",
  DISCOUNT_RATE: "#Price-Discount rate",
  ORIGINAL: "#Original-price_txt",
  DISCOUNT: "#Discounted price_txt",
  INTEREST_FREE: "#interest-free_txt",
};
const BANNER_PARENT_LAYER_NAMES = {
  TAG1: "#Prd_Tag_1",
  TAG2: "#Prd_Tag_2",
  INTEREST_FREE: "#interest-free",
  PRICE_TAG: "#Price_Tag",
};

async function findBannerTemplateNode(page, ids) {
  const t = await findTemplates(page, ids);
  return t.banner;
}

// 값을 채우는 레이어는 자신뿐 아니라 숨겨진 부모 컨테이너까지 다시 연다.
// (템플릿 기본 상태에서 가격/할인 영역이 hidden으로 되어 있는 경우가 있어서 필요함)
function bannerRevealNodeAndParents(node, rootNode) {
  let current = node;
  while (current) {
    current.visible = true;
    if (current === rootNode) break;
    current = current.parent;
  }
}

// 자식이 모두 숨겨진 오토레이아웃 컨테이너는 빈 여백을 남기지 않도록 함께 감춘다.
function bannerHideEmptyAutoLayoutContainers(node) {
  if (!("children" in node)) return;
  for (const child of node.children) bannerHideEmptyAutoLayoutContainers(child);
  if (node.layoutMode && node.layoutMode !== "NONE" && node.children.length > 0) {
    const hasVisibleChild = node.children.some((c) => c.visible);
    if (!hasVisibleChild) node.visible = false;
  }
}

async function setBannerTextLayer(rootNode, layerName, value) {
  const textNode = findNodeByName(rootNode, layerName);
  if (!textNode || textNode.type !== "TEXT") return;
  if (!value || !String(value).trim()) {
    textNode.visible = false;
    return;
  }
  bannerRevealNodeAndParents(textNode, rootNode);
  await setText(textNode, String(value).trim());
}

function setBannerLayerVisibility(rootNode, layerName, visible) {
  const node = findNodeByName(rootNode, layerName);
  if (node) node.visible = visible;
}

async function fillBannerItemData(node, data) {
  await setBannerTextLayer(node, BANNER_LAYER_NAMES.TITLE, data.title);
  await setBannerTextLayer(node, BANNER_LAYER_NAMES.SUBTITLE, data.subtitle);

  // 할인율/방송중 할인율 (문서에서 읽힌 값만 표시, 없으면 완전히 숨김)
  const hasDiscountRate = Boolean(data.discountRate && String(data.discountRate).trim());
  if (hasDiscountRate) {
    await setBannerTextLayer(node, BANNER_LAYER_NAMES.DISCOUNT_RATE, data.discountRate.trim());
  } else {
    setBannerLayerVisibility(node, BANNER_LAYER_NAMES.DISCOUNT_RATE, false);
  }

  // 가격 뱃지 (특가 + 카드할인 등)
  const hasPriceTag = Boolean(data.priceTag && String(data.priceTag).trim());
  if (hasPriceTag) {
    await setBannerTextLayer(node, BANNER_LAYER_NAMES.PRICE_TAG, data.priceTag.trim());
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.PRICE_TAG, true);
  } else {
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.PRICE_TAG, false);
  }

  await setBannerTextLayer(node, BANNER_LAYER_NAMES.ORIGINAL, data.originalPrice);
  await setBannerTextLayer(node, BANNER_LAYER_NAMES.DISCOUNT, data.discountedPrice);

  // Tag2 (BEST/NEW/단독 등) - 있으면 표시, 없으면 숨김
  const hasTag2 = Boolean(data.tag2 && String(data.tag2).trim());
  if (hasTag2) {
    await setBannerTextLayer(node, BANNER_LAYER_NAMES.TAG2, data.tag2.trim());
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.TAG2, true);
  } else {
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.TAG2, false);
    setBannerLayerVisibility(node, BANNER_LAYER_NAMES.TAG2, false);
  }

  // Tag1 (선택1, 선택2 등) - 없으면 숨김
  const hasTag1 = Boolean(data.tag1 && String(data.tag1).trim());
  if (hasTag1) {
    await setBannerTextLayer(node, BANNER_LAYER_NAMES.TAG1, data.tag1.trim());
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.TAG1, true);
  } else {
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.TAG1, false);
    setBannerLayerVisibility(node, BANNER_LAYER_NAMES.TAG1, false);
  }
  setBannerLayerVisibility(node, "#Prd_Tag", !hasTag1 && !hasTag2 ? false : true);

  // 무이자 정보 - 있으면 표시, 없으면 숨김
  if (data.interestFree && String(data.interestFree).trim()) {
    await setBannerTextLayer(node, BANNER_LAYER_NAMES.INTEREST_FREE, data.interestFree.trim());
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.INTEREST_FREE, true);
  } else {
    setBannerLayerVisibility(node, BANNER_PARENT_LAYER_NAMES.INTEREST_FREE, false);
    setBannerLayerVisibility(node, BANNER_LAYER_NAMES.INTEREST_FREE, false);
  }

  bannerHideEmptyAutoLayoutContainers(node);
}

async function generateBannerBundle(bannerItems, ids) {
  const page = figma.currentPage;
  const templateNode = await findBannerTemplateNode(page, ids);
  if (!templateNode) {
    figma.ui.postMessage({
      type: "banner-skip",
      message: "슬림배너용 'PrdList_Frame_1' 컴포넌트를 찾을 수 없어 슬림배너 생성은 건너뛰었습니다. (전면 CG는 정상 생성됨)"
    });
    return;
  }

  try {
    await loadEssentialFonts();
  } catch (e) {
    console.warn("슬림배너 폰트 로딩 경고:", e);
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const wrapperFrame = figma.createFrame();
  wrapperFrame.name = `슬림배너_묶음_${dateStr}`;
  wrapperFrame.layoutMode = "VERTICAL";
  wrapperFrame.itemSpacing = 20;
  wrapperFrame.paddingTop = 0;
  wrapperFrame.paddingBottom = 0;
  wrapperFrame.paddingLeft = 0;
  wrapperFrame.paddingRight = 0;
  wrapperFrame.primaryAxisSizingMode = "AUTO";
  wrapperFrame.counterAxisSizingMode = "AUTO";
  wrapperFrame.fills = [];
  wrapperFrame.x = templateNode.x + templateNode.width + 80;
  wrapperFrame.y = templateNode.y;
  page.appendChild(wrapperFrame);

  const createdNodes = [];
  for (let i = 0; i < bannerItems.length; i++) {
    const data = bannerItems[i];
    try {
      const cloneNode = templateNode.createInstance();
      cloneNode.name = String(i + 1).padStart(2, '0');
      wrapperFrame.appendChild(cloneNode);
      await fillBannerItemData(cloneNode, data);
      createdNodes.push(cloneNode);
    } catch (err) {
      console.error(`슬림배너 ${i + 1} 생성 오류:`, err);
    }
  }

  if (createdNodes.length > 0) {
    const maxHeight = Math.max(...createdNodes.map((n) => n.height));
    for (const node of createdNodes) {
      if (node.height !== maxHeight) {
        if ("layoutSizingVertical" in node) node.layoutSizingVertical = "FIXED";
        node.resize(node.width, maxHeight);
      }
    }
  }

  figma.ui.postMessage({ type: "banner-done", count: createdNodes.length });
}
