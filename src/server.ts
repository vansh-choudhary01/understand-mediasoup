import * as mediasoup from "mediasoup";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";


// ============================================================
// STEP 1 — CREATE MEDIASOUP ROUTER
// ============================================================

let router: mediasoup.types.Router;


// ============================================================
// STEP 2 — OUR APPLICATION STATE
// ============================================================
//
// mediasoup does NOT manage these Maps for our application.
// We use them to remember who owns what.
//

const producers =
    new Map<string, mediasoup.types.Producer>();

const consumers =
    new Map<string, mediasoup.types.Consumer>();

const producerOwners =
    new Map<string, WebSocket>();

const clients =
    new Set<WebSocket>();


// ============================================================
// STEP 3 — HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {

    if (req.url === "/") {

        const filePath = path.join(
            process.cwd(),
            "public",
            "index.html"
        );

        const html = fs.readFileSync(
            filePath,
            "utf-8"
        );

        res.writeHead(200, {
            "Content-Type": "text/html",
        });

        res.end(html);

        return;
    }

    res.writeHead(404);
    res.end("Not found");
});


// ============================================================
// STEP 4 — OUR WEBSOCKET SIGNALING SERVER
// ============================================================
//
// WebSocket is ONLY used for signaling.
// Actual audio/video goes through WebRTC + mediasoup.
//

const wss = new WebSocketServer({
    server,
});


// ============================================================
// STEP 5 — START MEDIASOUP
// ============================================================

(async function start() {

    const worker = await mediasoup.createWorker();
    // ↑ mediasoup server API.
    // ↑ Starts the mediasoup media worker.


    router = await worker.createRouter({
        // ↑ mediasoup server API.
        // ↑ Creates the SFU Router.

        mediaCodecs: [

            {
                kind: "audio",
                mimeType: "audio/opus",
                clockRate: 48000,
                channels: 2,
            },

            {
                kind: "video",
                mimeType: "video/VP8",
                clockRate: 90000,
            },

        ],
    });


    console.log("Worker and Router ready");


    // ========================================================
    // STEP 6 — USER CONNECTS
    // ========================================================

    wss.on("connection", (socket) => {

        console.log("User connected");

        clients.add(socket);


        // ----------------------------------------------------
        // THIS USER'S SEND TRANSPORT
        // ----------------------------------------------------

        let sendTransport:
            mediasoup.types.WebRtcTransport | undefined;


        // ----------------------------------------------------
        // THIS USER'S RECEIVE TRANSPORT
        // ----------------------------------------------------

        let recvTransport:
            mediasoup.types.WebRtcTransport | undefined;


        // ====================================================
        // STEP 7 — RECEIVE SIGNALING MESSAGE
        // ====================================================

        socket.on("message", async (message) => {

            try {

                const data =
                    JSON.parse(message.toString());


                // ==================================================
                // STEP 8 — USER JOINS
                // ==================================================

                if (data.type === "join") {
                    socket.send(JSON.stringify({

                        type: "load-routerRtpCapabilities",

                        data: {
                            routerRtpCapabilities:
                                router.rtpCapabilities,
                        },

                    }));
                    
                }

                if (data.type === "device-loaded") {
                    // ------------------------------------------------
                    // CREATE SEND TRANSPORT
                    // ------------------------------------------------

                    sendTransport =
                        await router.createWebRtcTransport({
                            // ↑ mediasoup server API.
                            // ↑ Transport used by browser → SFU.

                            listenInfos: [
                                {
                                    protocol: "udp",
                                    ip: "0.0.0.0",
                                },
                            ],
                        });


                    // ------------------------------------------------
                    // CREATE RECEIVE TRANSPORT
                    // ------------------------------------------------

                    recvTransport =
                        await router.createWebRtcTransport({
                            // ↑ mediasoup server API.
                            // ↑ Transport used by SFU → browser.

                            listenInfos: [
                                {
                                    protocol: "udp",
                                    ip: "0.0.0.0",
                                },
                            ],
                        });


                    // ------------------------------------------------
                    // SEND BOTH TRANSPORTS TO BROWSER
                    // ------------------------------------------------

                    socket.send(JSON.stringify({

                        type: "transport-created",

                        data: {

                            id: sendTransport.id,

                            iceParameters:
                                sendTransport.iceParameters,

                            iceCandidates:
                                sendTransport.iceCandidates,

                            dtlsParameters:
                                sendTransport.dtlsParameters,
                        },

                    }));


                    socket.send(JSON.stringify({

                        type: "recv-transport-created",

                        data: {

                            id: recvTransport.id,

                            iceParameters:
                                recvTransport.iceParameters,

                            iceCandidates:
                                recvTransport.iceCandidates,

                            dtlsParameters:
                                recvTransport.dtlsParameters,
                        },

                    }));


                    // ------------------------------------------------
                    // SEND PRODUCERS THAT ALREADY EXIST
                    // ------------------------------------------------

                    socket.send(JSON.stringify({

                        type: "existing-producers",

                        data: {

                            producerIds: [
                                ...producers.keys(),
                            ],

                        },

                    }));


                    return;
                }


                // ==================================================
                // STEP 9 — CONNECT SEND TRANSPORT
                // ==================================================

                if (data.type === "connect-transport") {

                    if (!sendTransport) {
                        throw new Error(
                            "Send transport not created"
                        );
                    }


                    await sendTransport.connect({
                        // ↑ mediasoup server API.
                        // ↑ Connects server-side send transport.

                        dtlsParameters:
                            data.data.dtlsParameters,
                    });


                    socket.send(JSON.stringify({
                        type: "transport-connected",
                    }));


                    return;
                }


                // ==================================================
                // STEP 10 — CREATE PRODUCER
                // ==================================================

                if (data.type === "produce") {

                    if (!sendTransport) {
                        throw new Error(
                            "Send transport not created"
                        );
                    }


                    const producer =
                        await sendTransport.produce({
                            // ↑ mediasoup server API.
                            // ↑ Creates Producer inside SFU.

                            kind:
                                data.data.kind,

                            rtpParameters:
                                data.data.rtpParameters,
                        });


                    console.log(
                        "Producer created:",
                        producer.id,
                        producer.kind
                    );


                    // ------------------------------------------------
                    // REMEMBER PRODUCER
                    // ------------------------------------------------

                    producers.set(
                        producer.id,
                        producer
                    );

                    producerOwners.set(
                        producer.id,
                        socket
                    );


                    // ------------------------------------------------
                    // TELL CREATOR THE PRODUCER ID
                    // ------------------------------------------------

                    socket.send(JSON.stringify({

                        type: "producer-created",

                        data: {

                            producerId:
                                producer.id,

                        },

                    }));


                    // ------------------------------------------------
                    // TELL OTHER USERS ABOUT NEW PRODUCER
                    // ------------------------------------------------

                    for (const client of clients) {

                        if (
                            client !== socket &&
                            client.readyState === WebSocket.OPEN
                        ) {

                            client.send(JSON.stringify({

                                type: "new-producer",

                                data: {

                                    producerId:
                                        producer.id,

                                },

                            }));

                        }

                    }


                    return;
                }


                // ==================================================
                // STEP 11 — CONNECT RECEIVE TRANSPORT
                // ==================================================

                if (
                    data.type ===
                    "connect-recv-transport"
                ) {

                    if (!recvTransport) {
                        throw new Error(
                            "Receive transport not created"
                        );
                    }


                    await recvTransport.connect({
                        // ↑ mediasoup server API.
                        // ↑ Connects server-side receive transport.

                        dtlsParameters:
                            data.data.dtlsParameters,
                    });


                    socket.send(JSON.stringify({

                        type:
                            "recv-transport-connected",

                    }));


                    return;
                }


                // ==================================================
                // STEP 12 — CREATE CONSUMER
                // ==================================================

                if (data.type === "consume") {

                    if (!recvTransport) {
                        throw new Error(
                            "Receive transport not created"
                        );
                    }


                    const producer =
                        producers.get(
                            data.data.producerId
                        );


                    if (!producer) {
                        throw new Error(
                            "Producer not found"
                        );
                    }


                    // ------------------------------------------------
                    // CHECK COMPATIBILITY
                    // ------------------------------------------------

                    const canConsume =
                        router.canConsume({
                            // ↑ mediasoup Router API.
                            // ↑ Checks whether this browser can
                            //   consume the Producer.

                            producerId:
                                producer.id,

                            rtpCapabilities:
                                data.data.rtpCapabilities,
                        });


                    if (!canConsume) {
                        throw new Error(
                            "Cannot consume producer"
                        );
                    }


                    // ------------------------------------------------
                    // CREATE SERVER CONSUMER
                    // ------------------------------------------------

                    const consumer =
                        await recvTransport.consume({
                            // ↑ mediasoup server API.

                            producerId:
                                producer.id,

                            rtpCapabilities:
                                data.data.rtpCapabilities,

                            paused: true,
                        });


                    consumers.set(
                        consumer.id,
                        consumer
                    );


                    // ------------------------------------------------
                    // SEND CONSUMER INFORMATION
                    // ------------------------------------------------

                    socket.send(JSON.stringify({

                        type:
                            "consumer-created",

                        data: {

                            id:
                                consumer.id,

                            producerId:
                                producer.id,

                            kind:
                                consumer.kind,

                            rtpParameters:
                                consumer.rtpParameters,

                        },

                    }));


                    return;
                }


                // ==================================================
                // STEP 13 — RESUME CONSUMER
                // ==================================================

                if (
                    data.type ===
                    "resume-consumer"
                ) {

                    const consumer =
                        consumers.get(
                            data.data.consumerId
                        );


                    if (!consumer) {
                        throw new Error(
                            "Consumer not found"
                        );
                    }


                    await consumer.resume();
                    // ↑ mediasoup Consumer API.
                    // ↑ Starts sending media.


                    return;
                }

            } catch (error) {

                console.error(
                    "WebSocket error:",
                    error
                );

            }

        });


        // ========================================================
        // STEP 14 — USER DISCONNECTS
        // ========================================================

        socket.on("close", () => {

            clients.delete(socket);

            console.log("User disconnected");


            // Close this user's Producers.

            for (
                const [producerId, owner]
                of producerOwners
            ) {

                if (owner === socket) {

                    const producer =
                        producers.get(
                            producerId
                        );

                    producer?.close();

                    producers.delete(
                        producerId
                    );

                    producerOwners.delete(
                        producerId
                    );
                }
            }

        });

    });


    // ========================================================
    // STEP 15 — START SERVER
    // ========================================================

    server.listen(3000, () => {

        console.log(
            "http://localhost:3000"
        );

    });

})();