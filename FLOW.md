# Mediasoup Group Call

## Architecture

```text
Browser A
   │
   │ WebSocket signaling
   ▼
Our Node.js server
   │
   ▼
mediasoup Router
   │
   ├──────────────┐
   ▼              ▼
Producer A     Producer B
   │              │
   └──────┬───────┘
          ▼
       Consumer
          │
          ▼
      Browser
```

---

## Step 1 — Worker

Server creates:

```ts
mediasoup.createWorker()
```

The Worker runs the mediasoup media engine.

---

## Step 2 — Router

Server creates:

```ts
worker.createRouter()
```

The Router is the SFU.

It receives media from Producers and sends it to Consumers.

---

## Step 3 — User joins

Browser sends:

```text
join
```

Server creates two transports:

```text
Send Transport
    Browser → SFU

Receive Transport
    SFU → Browser
```

---

## Step 4 — Connect transports

Browser gives the server its:

```text
DTLS parameters
```

Server calls:

```ts
transport.connect()
```

and:

```ts
recvTransport.connect()
```

This establishes the WebRTC transport connections.

---

## Step 5 — Produce

Browser gets:

```js
navigator.mediaDevices.getUserMedia()
```

Then:

```js
sendTransport.produce()
```

The server creates:

```ts
transport.produce()
```

Now the SFU has:

```text
Browser
   ↓
Producer
   ↓
Router
```

---

## Step 6 — Tell other users

When a Producer is created, our server sends:

```text
new-producer
```

to the other connected browsers.

This is **our application signaling**, not a mediasoup API.

---

## Step 7 — Consume

The other browser sends:

```text
consume
```

with:

```text
producerId
rtpCapabilities
```

Server checks:

```ts
router.canConsume()
```

Then creates:

```ts
recvTransport.consume()
```

Now the SFU has:

```text
Producer
   ↓
Router
   ↓
Consumer
```

---

## Step 8 — Browser Consumer

Server sends:

```text
consumer-created
```

Browser calls:

```js
recvTransport.consume()
```

This gives:

```js
consumer.track
```

We put the track into:

```js
new MediaStream([consumer.track])
```

and attach it to:

```js
video.srcObject
```

Now the remote video appears.

---

## Complete flow

```text
                    MEDIASOUP SFU

Browser A
   │
   │ produce()
   ▼
Producer A
   │
   ▼
 Router
   │
   ▼
Consumer A→B
   │
   ▼
Browser B
   │
   ▼
Remote <video>


Browser B
   │
   │ produce()
   ▼
Producer B
   │
   ▼
 Router
   │
   ▼
Consumer B→A
   │
   ▼
Browser A
   │
   ▼
Remote <video>
```

---

## Important distinction

### Our code

```text
WebSocket
join
produce
consume
new-producer
existing-producers
resume-consumer
Maps
```

These are our application's signaling/state-management logic.

### mediasoup

```text
Worker
Router
WebRtcTransport
Producer
Consumer
router.canConsume()
transport.produce()
transport.consume()
consumer.resume()
```

These are mediasoup APIs.

### Browser WebRTC

```text
getUserMedia()
MediaStream
MediaStreamTrack
video.srcObject
```

These are browser APIs.

---

## Current project status

```text
[✓] HTTP server
[✓] WebSocket signaling
[✓] mediasoup Worker
[✓] Router
[✓] Send transport
[✓] Receive transport
[✓] Device
[✓] Device.load()
[✓] Transport connection
[✓] Camera
[✓] Microphone
[✓] Producer
[✓] Existing producers
[✓] New producers
[✓] Consumer
[✓] Remote media
[✓] Consumer resume
```

The basic 2–3 person SFU call is now covered.

Next improvements should be made **one feature at a time**, rather than adding another large architectural jump.
