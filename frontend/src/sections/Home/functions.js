import axios, { SHS_API, fetchAll } from "../../api";
import * as _ from "lodash";

export async function getNodeData({ artistId = 0 }) {
  const artist = await axios.get(`${SHS_API}/artist/${artistId}`);
  const performances = await axios.get(`${SHS_API}/artist/${artistId}/performances`);

  return fetchAll(_.map(performances.data, "uri")).then(function (results) {
    // console.log("RESULTS", results);

    const artistOriginals = _.filter(results, function (result) {
      return result["isOriginal"] === true;
    });

    const artistCovers = _.filter(results, function (result) {
      return result["isOriginal"] === false;
    });

    // Get the original performer from the covers list
    let originalPerformances = _.map(artistCovers, function (cover) {
      return {
        selectedArtistCover: artist.data.commonName,
        selectedArtistUri: artist.data.uri,
        artist:
          cover["originals"].length > 0
            ? cover["originals"][0]["original"]["performer"]["name"]
            : "no name",
        artistUri:
          cover["originals"].length > 0
            ? cover["originals"][0]["original"]["performer"]["uri"]
            : "no uri",
        song:
          cover["works"].length > 0 ? cover["works"][0]["title"] : "no work",
        songUri:
          cover["works"].length > 0 ? cover["works"][0]["uri"] : "no uri",
      };
    });

    // Remove no uri from original performances
    originalPerformances = _.filter(originalPerformances, function (o) {
      return o.artistUri !== "no uri";
    });

    //   console.log("ORIGINAL PERFORMANCES", originalPerformances);

    // Get the band / artist playing the cover
    let coverPerformances = _.map(artistOriginals, function (original) {
      return {
        selectedArtistOriginal: artist.data.commonName,
        selectedArtistUri: artist.data.uri,
        artist:
          original["covers"].length > 0
            ? original["covers"][0]["performer"]["name"]
            : "no name",
        artistUri:
          original["covers"].length > 0
            ? original["covers"][0]["performer"]["uri"]
            : "no uri",
        song:
          original["works"].length > 0
            ? original["works"][0]["title"]
            : "no work",
        songUri:
          original["works"].length > 0 ? original["works"][0]["uri"] : "no uri",
      };
    });

    // Remove no uri from cover performances
    coverPerformances = _.filter(coverPerformances, function (o) {
      return o.artistUri !== "no uri";
    });

    return {
      artist,
      originalPerformances,
      coverPerformances,
    };
  });
}
