import React, { Component } from "react";
import * as _ from "lodash";

// import './index.scss';

class RelationshipType1 extends Component {
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
            <h2>Relationship type 1</h2>
            <h6>By song</h6>
            <p>When one of the entry artist covers the other</p>
            {relationships.AaCoverAb.length > 0 ? (
              <div className="col col-12 border">
                {/* <h4>
                  {nodeDataA["artist"]["data"]["commonName"]} covers{" "}
                  {nodeDataB["artist"]["data"]["commonName"]}
                </h4> */}
                {_.map(relationships.AaCoverAb, function (performance) {
                  return (
                    <p>
                      {performance.artist}, <i>{performance.song}</i> by <strong>{nodeDataA["artist"]["data"]["commonName"]}</strong>
                    </p>
                  );
                })}
              </div>
            ) : null}
            {relationships.AbCoverAa.length > 0 ? (
              <div className="col col-12 border">
                <h4>
                  {nodeDataB["artist"]["data"]["commonName"]} covers{" "}
                  {nodeDataA["artist"]["data"]["commonName"]}
                </h4>
                {_.map(relationships.AbCoverAa, function (performance, index) {
                  return (
                    <p key={performance.song + "-" + index}>
                      {performance.artist} - {performance.song} by {nodeDataB["artist"]["data"]["commonName"]}
                    </p>
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

export default RelationshipType1;
