# vibes-render

## installation and usage

```shell
npm install
node render.js
```

## notes

uses an AWS lambda function to render remotely, falling back to local renders if those timeout.

the AWS host and Web3 provider keys have been removed, and would need to be filled with your own services to use this code as is.

there is probably a better way to batch render locally that i missed, using threads or child processes; AWS may not have been necessary.
