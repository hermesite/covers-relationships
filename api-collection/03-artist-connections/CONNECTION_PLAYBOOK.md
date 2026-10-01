# Artist Connection Playbook

Goal: explore links between Artist A and Artist B by iterating over artists and songs.

## Setup

1. Pick environment:
- environments/local-proxy.bru (recommended)
- environments/upstream.bru

2. Set variables:
- artistAId
- artistBId
- optional hopArtistId
- optional candidatePerformanceId

## Connection Type 1
Any of the artists covers an original from the other.

Run:
1. 03-artist-a-performances.bru
2. 04-artist-b-performances.bru
3. 05-candidate-performance-detail.bru for candidate performance ids from (1) and (2)

Check:
- In Artist A performances, inspect originals[].original.uri and compare with Artist B original performance uris.
- In Artist B performances, inspect originals[].original.uri and compare with Artist A original performance uris.

## Connection Type 2
Any third artist covers songs from both Artist A and Artist B.

Run:
1. 03-artist-a-performances.bru
2. 04-artist-b-performances.bru
3. 05-candidate-performance-detail.bru for original songs of A and B

Check:
- Build set Coverers(A): all cover.performer.uri that cover A originals.
- Build set Coverers(B): all cover.performer.uri that cover B originals.
- Intersection Coverers(A) ∩ Coverers(B) are shared covering artists.
- Put one uri id into hopArtistId and run 06-hop-artist-performances.bru.

## Connection Type 3
Second-grade links through shared coverers.

Run:
1. Find shared coverers from Type 2.
2. For each shared coverer, run 06-hop-artist-performances.bru.
3. For each performance in hop artist, run 05-candidate-performance-detail.bru.

Check:
- Identify which originals the hop artist covered.
- Follow performer uri of those originals to discover bridge artists.
- Repeat one more hop if needed.

## Additional Recursive Ideas

1. Shared originals by work identity:
- Compare work uri across originals that A and B connect to.
- If both paths hit same work uri, mark as structural connection.

2. Temporal overlap recursion:
- Use performance date/year fields (if present) to find periods where both artists are co-covered.
- Follow coverers active in both periods.

3. Label/release bridge:
- From candidate performance detail, take release uri or label uri.
- Run exploratory release/label requests and inspect artist links.

4. Two-hop coverer graph:
- Hop 1: shared coverers of A and B.
- Hop 2: artists covered by those shared coverers.
- Rank bridges by frequency.

5. Contrafact/derived-work exploration:
- Where available in performance payload, inspect derivedWorks or versions.
- Follow those uris as alternative path beyond direct covers.

## Practical Tip

Use local-proxy environment while app dev server is running to reduce upstream rate-limit interruptions.
