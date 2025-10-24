import {
  genTerrainFromBin,
  MapMetadata,
} from "../../../src/core/game/TerrainMapLoader";

const baseMapData: MapMetadata = {
  width: 2,
  height: 2,
  num_land_tiles: 3,
};

const baseTerrain = new Uint8Array([1, 2, 3, 4]);

describe("genTerrainFromBin", () => {
  test("loads terrain without header", async () => {
    const map = await genTerrainFromBin(baseMapData, baseTerrain.slice());

    expect(map.width()).toBe(baseMapData.width);
    expect(map.height()).toBe(baseMapData.height);
    expect(map.numLandTiles()).toBe(baseMapData.num_land_tiles);
  });

  test("supports width, height, and land tile header", async () => {
    const headerBytes = 12;
    const data = new Uint8Array(headerBytes + baseTerrain.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, baseMapData.width, true);
    view.setUint32(4, baseMapData.height, true);
    view.setUint32(8, 99, true);
    data.set(baseTerrain, headerBytes);

    const map = await genTerrainFromBin(baseMapData, data);

    expect(map.width()).toBe(baseMapData.width);
    expect(map.height()).toBe(baseMapData.height);
    expect(map.numLandTiles()).toBe(99);
  });

  test("supports width and height header", async () => {
    const headerBytes = 8;
    const data = new Uint8Array(headerBytes + baseTerrain.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, baseMapData.width, true);
    view.setUint32(4, baseMapData.height, true);
    data.set(baseTerrain, headerBytes);

    const map = await genTerrainFromBin(baseMapData, data);

    expect(map.width()).toBe(baseMapData.width);
    expect(map.height()).toBe(baseMapData.height);
    expect(map.numLandTiles()).toBe(baseMapData.num_land_tiles);
  });

  test("supports land tile header", async () => {
    const headerBytes = 4;
    const data = new Uint8Array(headerBytes + baseTerrain.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, 17, true);
    data.set(baseTerrain, headerBytes);

    const map = await genTerrainFromBin(baseMapData, data);

    expect(map.width()).toBe(baseMapData.width);
    expect(map.height()).toBe(baseMapData.height);
    expect(map.numLandTiles()).toBe(17);
  });

  test("throws when embedded dimensions do not match manifest", async () => {
    const headerBytes = 8;
    const data = new Uint8Array(headerBytes + baseTerrain.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, baseMapData.width + 1, true);
    view.setUint32(4, baseMapData.height, true);
    data.set(baseTerrain, headerBytes);

    await expect(genTerrainFromBin(baseMapData, data)).rejects.toThrow(
      "embedded dimensions",
    );
  });

  test("throws when extra header bytes are unexpected", async () => {
    const data = new Uint8Array(baseTerrain.length + 2);
    data.set(baseTerrain, 2);

    await expect(genTerrainFromBin(baseMapData, data)).rejects.toThrow(
      "unexpected header bytes",
    );
  });

  test("throws when buffer is too small", async () => {
    const data = baseTerrain.slice(0, baseTerrain.length - 1);

    await expect(genTerrainFromBin(baseMapData, data)).rejects.toThrow(
      "too small",
    );
  });
});
