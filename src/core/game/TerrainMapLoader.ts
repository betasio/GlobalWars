import { GameMapSize, GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  nations: Nation[];
  gameMap: GameMap;
  miniGameMap: GameMap;
};

const loadedMaps = new Map<GameMapType, TerrainMapData>();

export interface MapMetadata {
  width: number;
  height: number;
  num_land_tiles: number;
}

export interface MapManifest {
  name: string;
  map: MapMetadata;
  map4x: MapMetadata;
  map16x: MapMetadata;
  nations: Nation[];
}

export interface Nation {
  coordinates: [number, number];
  flag: string;
  name: string;
  strength: number;
}

export async function loadTerrainMap(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
): Promise<TerrainMapData> {
  const cached = loadedMaps.get(map);
  if (cached !== undefined) return cached;
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(manifest.map, await mapFiles.mapBin())
      : await genTerrainFromBin(manifest.map4x, await mapFiles.map4xBin());

  const miniMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x,
          await mapFiles.map4xBin(),
        )
      : await genTerrainFromBin(manifest.map16x, await mapFiles.map16xBin());

  if (mapSize === GameMapSize.Compact) {
    manifest.nations.forEach((nation) => {
      nation.coordinates = [
        Math.floor(nation.coordinates[0] / 2),
        Math.floor(nation.coordinates[1] / 2),
      ];
    });
  }

  const result = {
    nations: manifest.nations,
    gameMap: gameMap,
    miniGameMap: miniMap,
  };
  loadedMaps.set(map, result);
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
): Promise<GameMap> {
  const expectedLength = mapData.width * mapData.height;

  if (data.length < expectedLength) {
    throw new Error(
      `Invalid data: buffer size ${data.length} is too small for ${mapData.width}x${mapData.height} terrain.`,
    );
  }

  const extraBytes = data.length - expectedLength;
  let headerView: DataView | null = null;
  let offset = 0;
  let numLandTiles = mapData.num_land_tiles;

  if (extraBytes === 12 || extraBytes === 8 || extraBytes === 4) {
    headerView = new DataView(data.buffer, data.byteOffset, extraBytes);

    if (extraBytes >= 8) {
      const headerWidth = headerView.getUint32(0, true);
      const headerHeight = headerView.getUint32(4, true);

      if (headerWidth !== mapData.width || headerHeight !== mapData.height) {
        throw new Error(
          `Invalid data: embedded dimensions ${headerWidth}x${headerHeight} do not match manifest ${mapData.width}x${mapData.height}.`,
        );
      }
    }

    if (extraBytes === 12) {
      numLandTiles = headerView.getUint32(8, true);
      offset = 12;
    } else if (extraBytes === 8) {
      offset = 8;
    } else {
      numLandTiles = headerView.getUint32(0, true);
      offset = 4;
    }
  } else if (extraBytes !== 0) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain with ${extraBytes} unexpected header bytes.`,
    );
  }

  const terrainData = data.subarray(offset, offset + expectedLength);

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    terrainData,
    numLandTiles,
  );
}
