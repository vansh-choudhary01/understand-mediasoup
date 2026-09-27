import * as mediasoupClient from "mediasoup-client";


// ============================================================
// STEP 1 — OUR CLIENT STATE
// ============================================================

let device;

let sendTransport;

let recvTransport;


// Producer IDs that arrive before the receive transport
// is ready.

const pendingProducerIds = [];


// Callbacks waiting for our server's signaling response.

let sendTransportConnectCallback;
let recvTransportConnectCallback;


// Producer callbacks are stored by media kind.

const producerCallbacks = new Map();


// ============================================================
// STEP 2 — CONNECT TO OUR SIGNALING SERVER
// ============================================================

const socket =
    new WebSocket("ws://localhost:3000");


// ============================================================
// STEP 3 — JOIN
// ============================================================

socket.onopen = () => {

    console.log("WebSocket connected");


    socket.send(JSON.stringify({

        type: "join",

    }));

};


// ============================================================
// STEP 4 — RECEIVE SIGNALING MESSAGES
// ============================================================

socket.onmessage = async (event) => {

    const message =
        JSON.parse(event.data);


    console.log(
        "Server:",
        message.type
    );

    if (
        message.type ===
        "load-routerRtpCapabilities"
    ) {

        const data =
            message.data;
                // ----------------------------------------------------
        // CREATE MEDIASOUP DEVICE
        // ----------------------------------------------------

        device =
            new mediasoupClient.Device();
        // ↑ mediasoup-client API.
        // ↑ Represents this browser's mediasoup client.


        // ----------------------------------------------------
        // LOAD SERVER CAPABILITIES
        // ----------------------------------------------------

        await device.load({
            // ↑ mediasoup-client API.

            routerRtpCapabilities:
                data.routerRtpCapabilities,
        });


        console.log("Device loaded");
        socket.send(JSON.stringify({

            type:
                "device-loaded",

        }));
    }


    // ========================================================
    // STEP 5 — SEND TRANSPORT CREATED
    // ========================================================

    if (
        message.type ===
        "transport-created"
    ) {

        const data =
            message.data;


        // ----------------------------------------------------
        // CREATE SEND TRANSPORT
        // ----------------------------------------------------

        sendTransport =
            device.createSendTransport({
                // ↑ mediasoup-client API.

                id:
                    data.id,

                iceParameters:
                    data.iceParameters,

                iceCandidates:
                    data.iceCandidates,

                dtlsParameters:
                    data.dtlsParameters,
            });


        // ====================================================
        // SEND TRANSPORT CONNECT
        // ====================================================

        sendTransport.on(
            "connect",
            (
                { dtlsParameters },
                callback,
                errback
            ) => {

                // ↑ mediasoup-client API.
                // ↑ Fires when the transport needs
                //   to establish DTLS.


                sendTransportConnectCallback =
                    callback;


                socket.send(JSON.stringify({

                    type:
                        "connect-transport",

                    data: {

                        dtlsParameters,

                    },

                }));

            }
        );


        // ====================================================
        // PRODUCE
        // ====================================================

        sendTransport.on(
            "produce",
            (
                {
                    kind,
                    rtpParameters
                },
                callback,
                errback
            ) => {

                // ↑ mediasoup-client API.
                // ↑ Asks our server to create
                //   the Producer.


                producerCallbacks.set(
                    kind,
                    callback
                );


                socket.send(JSON.stringify({

                    type:
                        "produce",

                    data: {

                        kind,

                        rtpParameters,

                    },

                }));

            }
        );


        // ----------------------------------------------------
        // START CAMERA
        // ----------------------------------------------------

        await startCamera();


        return;
    }


    // ========================================================
    // STEP 6 — SEND TRANSPORT CONNECTED
    // ========================================================

    if (
        message.type ===
        "transport-connected"
    ) {

        sendTransportConnectCallback?.();

        sendTransportConnectCallback =
            undefined;


        return;
    }


    // ========================================================
    // STEP 7 — PRODUCER CREATED
    // ========================================================

    if (
        message.type ===
        "producer-created"
    ) {

        const producerId =
            message.data.producerId;


        // The callback belongs to the media kind
        // that was being produced.

        // For this tutorial we determine it from
        // the pending callback.

        for (
            const [
                kind,
                callback
            ]
            of producerCallbacks
        ) {

            callback({
                id: producerId,
            });

            producerCallbacks.delete(kind);

            break;
        }


        return;
    }


    // ========================================================
    // STEP 8 — RECEIVE TRANSPORT CREATED
    // ========================================================

    if (
        message.type ===
        "recv-transport-created"
    ) {

        const data =
            message.data;


        recvTransport =
            device.createRecvTransport({
                // ↑ mediasoup-client API.
                // ↑ Creates browser receive transport.

                id:
                    data.id,

                iceParameters:
                    data.iceParameters,

                iceCandidates:
                    data.iceCandidates,

                dtlsParameters:
                    data.dtlsParameters,
            });


        // ====================================================
        // RECEIVE TRANSPORT CONNECT
        // ====================================================

        recvTransport.on(
            "connect",
            (
                { dtlsParameters },
                callback,
                errback
            ) => {

                // ↑ mediasoup-client API.


                recvTransportConnectCallback =
                    callback;


                socket.send(JSON.stringify({

                    type:
                        "connect-recv-transport",

                    data: {

                        dtlsParameters,

                    },

                }));

            }
        );


        console.log(
            "Receive transport created"
        );


        // ----------------------------------------------------
        // PROCESS PRODUCERS THAT ARRIVED EARLY
        // ----------------------------------------------------

        while (
            pendingProducerIds.length > 0
        ) {

            const producerId =
                pendingProducerIds.shift();


            consumeProducer(
                producerId
            );

        }


        return;
    }


    // ========================================================
    // STEP 9 — RECEIVE TRANSPORT CONNECTED
    // ========================================================

    if (
        message.type ===
        "recv-transport-connected"
    ) {

        recvTransportConnectCallback?.();

        recvTransportConnectCallback =
            undefined;


        console.log(
            "Receive transport connected"
        );


        return;
    }


    // ========================================================
    // STEP 10 — EXISTING PRODUCERS
    // ========================================================

    if (
        message.type ===
        "existing-producers"
    ) {

        const producerIds =
            message.data.producerIds;


        for (
            const producerId
            of producerIds
        ) {

            if (!recvTransport) {

                pendingProducerIds.push(
                    producerId
                );

                continue;
            }


            consumeProducer(
                producerId
            );

        }


        return;
    }


    // ========================================================
    // STEP 11 — NEW PRODUCER
    // ========================================================

    if (
        message.type ===
        "new-producer"
    ) {

        const producerId =
            message.data.producerId;


        if (!recvTransport) {

            pendingProducerIds.push(
                producerId
            );

            return;
        }


        consumeProducer(
            producerId
        );


        return;
    }


    // ========================================================
    // STEP 12 — CONSUMER CREATED
    // ========================================================

    if (
        message.type ===
        "consumer-created"
    ) {

        const data =
            message.data;


        const consumer =
            await recvTransport.consume({
                // ↑ mediasoup-client API.
                // ↑ Creates browser-side Consumer.

                id:
                    data.id,

                producerId:
                    data.producerId,

                kind:
                    data.kind,

                rtpParameters:
                    data.rtpParameters,
            });


        // ----------------------------------------------------
        // CREATE MEDIA STREAM
        // ----------------------------------------------------

        const stream =
            new MediaStream([
                consumer.track,
            ]);
        // ↑ Browser WebRTC API.


        // ----------------------------------------------------
        // CREATE REMOTE MEDIA ELEMENT
        // ----------------------------------------------------

        const media =
            document.createElement(
                data.kind === "video"
                    ? "video"
                    : "audio"
            );


        media.autoplay = true;

        media.playsInline = true;

        media.srcObject = stream;


        document
            .querySelector("#remoteVideos")
            .appendChild(media);


        // ----------------------------------------------------
        // TELL SERVER TO RESUME
        // ----------------------------------------------------

        socket.send(JSON.stringify({

            type:
                "resume-consumer",

            data: {

                consumerId:
                    data.id,

            },

        }));


        console.log(
            "Remote",
            data.kind,
            "connected"
        );


        return;
    }

};


// ============================================================
// STEP 13 — GET CAMERA + MICROPHONE
// ============================================================

async function startCamera() {

    const stream =
        await navigator.mediaDevices.getUserMedia({
            // ↑ Browser WebRTC API.

            audio: true,

            video: true,
        });


    // ========================================================
    // SHOW OUR OWN CAMERA
    // ========================================================

    const localVideo =
        document.querySelector(
            "#localVideo"
        );


    localVideo.srcObject =
        stream;


    // ========================================================
    // SEND VIDEO TO MEDIASOUP
    // ========================================================

    const videoTrack =
        stream.getVideoTracks()[0];


    await sendTransport.produce({
        // ↑ mediasoup-client API.

        track:
            videoTrack,
    });


    // ========================================================
    // SEND AUDIO TO MEDIASOUP
    // ========================================================

    const audioTrack =
        stream.getAudioTracks()[0];


    await sendTransport.produce({
        // ↑ mediasoup-client API.

        track:
            audioTrack,
    });


    console.log(
        "Camera + microphone produced"
    );

}


// ============================================================
// STEP 14 — REQUEST A CONSUMER
// ============================================================

function consumeProducer(
    producerId
) {

    if (!device) {
        return;
    }


    if (!recvTransport) {
        return;
    }


    socket.send(JSON.stringify({

        type:
            "consume",

        data: {

            producerId,

            rtpCapabilities:
                device.rtpCapabilities,
            // ↑ mediasoup-client API.
            // ↑ Tells the server what this browser
            //   can receive.

        },

    }));

}