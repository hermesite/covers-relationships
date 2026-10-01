import React, { Component } from "react";
import * as _ from "lodash";

// import './index.scss';

class RelationshipType2 extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
    };
  }

  componentDidMount() {
    this.setState({
      loading: false,
    });
  }

  render() {
    const { loading } = this.state;
    const { relationships, nodeDataA, nodeDataB } = this.props;
    return (
      <div className="container border">
        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="row border">
            <h2>Relationship type 2</h2>
            <h6>By artist (cover song)</h6>
            <p>When both entry artists cover a song from the same artist</p>
            {relationships.coversList.length > 0 ? (
              <div className="col col-12 border">
                {_.map(relationships.coversList, function (artist) {
                  return (
                    <div>
                      {_.map(
                        relationships.coversByArtist[artist],
                        (performance) => {
                          return (
                            <p className="m-0">
                              {performance.artist} - <i>{performance.song}</i> by <strong>{performance.selectedArtistCover}</strong>
                            </p>
                          );
                        }
                      )}
                    </div>
                  );
                })}
                </div>
            ) : null}
            <h6>By artist (original song)</h6>
            <p>Same artist cover song of entry artists</p>
            {relationships.originalsList.length > 0 ? (
              <div className="col col-12 border">
                {_.map(relationships.originalsList, function (artist) {
                  return (
                    <div>
                      {_.map(
                        relationships.originalsByArtist[artist],
                        (performance) => {
                          return (
                            <p className="m-0">
                              {performance.selectedArtistOriginal} - <i>{performance.song}</i> by <strong>{performance.artist}</strong>
                            </p>
                          );
                        }
                        )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            
          </div>
        )}
      </div>
    );
  }
}

export default RelationshipType2;
