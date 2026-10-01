import React, { Component } from "react";
import * as _ from "lodash";

import RelationshipType1 from "../../components/RelationShipType1";
import RelationshipType2 from "../../components/RelationShipType2";

import { getNodeData } from "./functions";
// import './index.scss';

class Home extends Component {
  constructor() {
    super();
    this.state = {
      loading: true,
      schema: {
        artA: {
          id: 194, // David Bowie
        },
        artB: {
          id: 604, // Ramones
        },
      },
    };
  }

  async componentDidMount() {
    const nodeDataA = await getNodeData({
      artistId: this.state.schema["artA"].id,
    });
    const nodeDataB = await getNodeData({
      artistId: this.state.schema["artB"].id,
    });

    console.log("NODE DATA", nodeDataA);

    // Concatenate the two lists
    const nodeDataAFull = _.concat(
      nodeDataA["originalPerformances"],
      nodeDataA["coverPerformances"]
    );

    const nodeDataBFull = _.concat(
      nodeDataB["originalPerformances"],
      nodeDataB["coverPerformances"]
    );

    // Intersection of the two lists
    const intersectionAB = _.intersectionBy(
      nodeDataAFull,
      nodeDataBFull,
      "artistUri"
    );

    // and reverse
    const intersectionBA = _.intersectionBy(
      nodeDataBFull,
      nodeDataAFull,
      "artistUri"
    );

    // const intersectionCover = _.intersectionBy(
    //   nodeDataA['originalPerformances'],
    //   nodeDataB['originalPerformances'],
    //     "artistUri"
    // );

    console.log("INTERSECTION A->B", intersectionAB);
    console.log("INTERSECTION B->A", intersectionBA);

    // Difference list by cover or original
    const artistACovers = _.filter(intersectionAB, function (o) {
      return o.selectedArtistCover;
    });

    const artistAOriginals = _.filter(intersectionAB, function (o) {
      return o.selectedArtistOriginal;
    });

    const artistBCovers = _.filter(intersectionBA, function (o) {
      return o.selectedArtistCover;
    });

    const artistBOriginals = _.filter(intersectionBA, function (o) {
      return o.selectedArtistOriginal;
    });

    console.log("artistACovers", artistACovers);
    console.log("artistAOriginals", artistAOriginals);
    console.log("artistBCovers", artistBCovers);
    console.log("artistBOriginals", artistBOriginals);

    // Relationship type 2 
    // Both entry artists cover the same artist
    // Get a list of artists that are in both lists
    const coversList = artistACovers.map((cover) => {
      console.log("cover", cover);
      return cover["artistUri"];
    });

    const originalsList = artistAOriginals.map((original) => {
      console.log("original", original);
      return original["artistUri"];
    });

    // concat covers lists and group by artist
    const coversByArtist = _.concat(
      artistACovers,
      artistBCovers
    ).reduce((r, a) => {
      r[a.artistUri] = [...(r[a.artistUri] || []), a];
      return r;
    }, {});

    console.log("coversByArtist", coversByArtist);

    // the same for originals
    const originalsByArtist = _.concat(
      artistAOriginals,
      artistBOriginals
    ).reduce((r, a) => {
      r[a.artistUri] = [...(r[a.artistUri] || []), a];
      return r;
    }, {});

    console.log("originalsByArtist", originalsByArtist);

    


    // set relationship by song
    // ie. if song is in both lists, then it's a relationship

    // set relationship by artist
    // check if scope artist uri is in either list
    const AaCoverAb = _.filter(intersectionAB, function (o) {
      return o.artistUri === intersectionBA[0]["selectedArtistUri"];
    });

    const AbCoverAa = _.filter(intersectionBA, function (o) {
      return o.artistUri === intersectionAB[0]["selectedArtistUri"];
    });

    console.log("-------- AaCoverAb --------", AaCoverAb);
    console.log("-------- AbCoverAa --------", AbCoverAa);




    this.setState({
      loading: false,
      nodeDataA: nodeDataA,
      nodeDataB: nodeDataB,
      performancesA: intersectionAB,
      performancesB: intersectionBA,
      relationships: {
        AaCoverAb: AaCoverAb,
        AbCoverAa: AbCoverAa,
        coversByArtist: coversByArtist,
        originalsByArtist: originalsByArtist,
        originalsList: originalsList,
        coversList: coversList,
      },
    });
  }

  render() {
    const { loading, nodeDataA, nodeDataB, performancesA, performancesB, relationships } =
      this.state;
    return (
      <section className="section section-home">
        <div className="container border">
          <p>
            You must choose my brother, are you gonna be problem or are you
            gonna the solution
          </p>
          {loading ? (
            <p>Loading...</p>
          ) : (
            <div className="row border">
              <h1>{nodeDataA["artist"]["data"]["commonName"]} & {nodeDataB["artist"]["data"]["commonName"]}</h1>
              <h2>Relationships</h2>
              {/* Type 1 */}
              <RelationshipType1
                nodeDataA={nodeDataA}
                nodeDataB={nodeDataB}
                relationships={relationships}
              />
              {/* Type 2 */}
              <RelationshipType2
                nodeDataA={nodeDataA}
                nodeDataB={nodeDataB}
                relationships={relationships}
              />

              <div className="col col-6 border">
                <h4>{nodeDataA['artist']['data']['commonName']}</h4>
                {_.map(performancesA, function (performance) {
                  return (
                    <p>
                      {performance.artist} - {performance.song}
                    </p>
                  );
                })}
              </div>
              <div className="col col-6 border">
                <h4>{nodeDataB['artist']['data']['commonName']}</h4>
                {_.map(performancesB, function (performance) {
                  return (
                    <p>
                      {performance.artist} - {performance.song}
                    </p>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }
}

export default Home;
