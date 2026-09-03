import { afterEach, describe, expect, it, vi } from "vitest"

import type { Entity } from "../../../packages/core/src/index"
import {
  defaultCatalogSources,
  listCatalogSources,
  triggersFor,
} from "./catalog-sources"
import { mergeSyncedTriggers } from "./lexicon-repository"

function entity(triggers: Entity["triggers"]): Entity {
  return {
    id: "riot-syndra",
    displayName: "暗黑元首",
    pack: "英雄联盟",
    category: "游戏角色",
    description: "",
    imageUrl: "https://example.com/syndra.jpg",
    source: "Riot Data Dragon",
    licenseStatus: "prototype",
    enabled: true,
    popularity: 75,
    triggers,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("catalog triggers", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("only generates complete proper names", () => {
    expect(
      triggersFor("riot-ekko", ["时间刺客", "艾克"]).map(
        (trigger) => trigger.text,
      ),
    ).toEqual(["时间刺客", "艾克"])
    expect(
      triggersFor("riot-syndra", ["暗黑元首", "辛德拉"]).map(
        (trigger) => trigger.text,
      ),
    ).toEqual(["暗黑元首", "辛德拉"])
    expect(
      triggersFor("bangumi-55770", ["進撃の巨人", "进击的巨人"]).map(
        (trigger) => trigger.text,
      ),
    ).toEqual(["进击的巨人"])
  })

  it("exposes source attribution for the admin details page", () => {
    const sources = listCatalogSources()

    expect(sources).toHaveLength(9)
    expect(sources.every((source) => source.provider && source.sourceUrl)).toBe(
      true,
    )
  })

  it("removes old generated prefixes while preserving manual aliases", () => {
    const existing = entity([
      {
        id: "riot-syndra-trigger-2",
        text: "辛德",
        kind: "prefix",
        weight: 8,
      },
      {
        id: "riot-syndra-custom",
        text: "球女",
        kind: "manual",
        weight: 20,
      },
    ])
    const incoming = entity(
      triggersFor("riot-syndra", ["暗黑元首", "辛德拉"]),
    )

    expect(
      mergeSyncedTriggers(existing, incoming).map((trigger) => trigger.text),
    ).toEqual(["球女", "暗黑元首", "辛德拉"])
  })

  it("maps Bangumi subjects to Chinese anime entities", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          {
            id: 55770,
            name: "進撃の巨人",
            name_cn: "进击的巨人",
            images: { large: "https://lain.bgm.tv/attack-on-titan.jpg" },
            collection: { collect: 52_179 },
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetcher)

    const entities = await defaultCatalogSources.bangumi.sync(1)

    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({
      id: "bangumi-55770",
      displayName: "进击的巨人",
      pack: "热门动漫",
      imageUrl: "https://lain.bgm.tv/attack-on-titan.jpg",
    })
    expect(entities[0].triggers.map((trigger) => trigger.text)).toEqual([
      "进击的巨人",
    ])
  })

  it("maps Chinese game character catalogs with artwork", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("genshin-dictionary")) {
        return Response.json([
          {
            id: "zhongli",
            en: "Zhongli",
            zhCN: "钟离",
            tags: ["character-main"],
          },
        ])
      }
      if (url.endsWith("/characters")) {
        return Response.json(["zhongli"])
      }
      if (url.includes("StarRailStaticAPI")) {
        return Response.json({
          "1001": {
            id: "1001",
            name: "三月七",
            rarity: 4,
            portrait: "image/character_portrait/1001.png",
          },
        })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetcher)

    const [genshin, starRail] = await Promise.all([
      defaultCatalogSources.genshin.sync(100),
      defaultCatalogSources.starrail.sync(100),
    ])

    expect(genshin[0]).toMatchObject({
      id: "genshin-zhongli",
      displayName: "钟离",
      pack: "原神",
    })
    expect(starRail[0]).toMatchObject({
      id: "starrail-1001",
      displayName: "三月七",
      pack: "崩坏：星穹铁道",
    })
  })

  it("ranks Wikipedia people by pageviews and keeps usable portraits", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.searchParams.get("list") === "categorymembers") {
        return Response.json({
          query: {
            categorymembers: [
              { pageid: 1, title: "李白" },
              { pageid: 2, title: "诸葛亮（政治家）" },
              { pageid: 3, title: "无图人物" },
            ],
          },
        })
      }
      return Response.json({
        query: {
          pages: [
            {
              pageid: 1,
              title: "李白",
              thumbnail: { source: "https://upload.wikimedia.org/li-bai.jpg" },
              pageviews: { "2026-09-01": 100 },
            },
            {
              pageid: 2,
              title: "诸葛亮（政治家）",
              thumbnail: {
                source: "https://upload.wikimedia.org/zhuge-liang.jpg",
              },
              pageviews: { "2026-09-01": 500 },
            },
            {
              pageid: 3,
              title: "无图人物",
              pageviews: { "2026-09-01": 1_000 },
            },
          ],
        },
      })
    })
    vi.stubGlobal("fetch", fetcher)

    const entities = await defaultCatalogSources["wikipedia-history"].sync(2)

    expect(entities.map((item) => item.displayName)).toEqual(["诸葛亮", "李白"])
    expect(entities[0]).toMatchObject({
      pack: "历史人物",
      category: "历史人物",
      source: "中文维基百科 #2",
    })
    expect(entities[0].triggers.map((trigger) => trigger.text)).toEqual([
      "诸葛亮",
    ])
  })

  it("maps NetEase popular musicians and groups with artist images", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/api/artist/top")) {
        return Response.json({
          code: 200,
          artists: [
            {
              id: 3684,
              name: "林俊杰",
              picUrl: "http://p1.music.126.net/lin.jpg",
            },
            {
              id: 7763,
              name: "G.E.M.邓紫棋",
              picUrl: "http://p1.music.126.net/gem.jpg",
            },
          ],
        })
      }
      if (url.includes("/discover/artist/cat")) {
        return new Response(
          '<a href="/artist?id=11564" class="nm f-thide">凤凰传奇</a>' +
            '<a href="/artist?id=1161122" class="nm f-thide">草东没有派对</a>',
        )
      }
      const id = Number(url.match(/\/api\/artist\/(\d+)/u)?.[1])
      return Response.json({
        code: 200,
        artist: {
          id,
          name: id === 11564 ? "凤凰传奇" : "草东没有派对",
          picUrl: `http://p1.music.126.net/${id}.jpg`,
        },
      })
    })
    vi.stubGlobal("fetch", fetcher)

    const [musicians, groups] = await Promise.all([
      defaultCatalogSources["netease-musicians"].sync(2),
      defaultCatalogSources["netease-groups"].sync(2),
    ])

    expect(musicians.map((item) => item.displayName)).toEqual([
      "林俊杰",
      "邓紫棋",
    ])
    expect(groups.map((item) => item.displayName)).toEqual([
      "凤凰传奇",
      "草东没有派对",
    ])
    expect(groups[0]).toMatchObject({
      category: "乐队组合",
      imageUrl: "https://p1.music.126.net/11564.jpg",
    })
  })
})
