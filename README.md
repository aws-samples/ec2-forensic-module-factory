# EC2 Forensic Module Build Factory

The CDK project will deploy all AWS resources and infrastructure required to build EC2 forensic modules.

AWS Resources Include:
- (1) AWS Step Function
- (2) AWS Lambda Function
- (1) AWS Systems Manager Document
    - IMPORTANT: The document clones the following repositories, which utilize the GNU license. This document can be updated to your specific tools for forensic analysis and capture.
        - [LiME](https://github.com/504ensicsLabs/LiME)
        - [Volatility2](https://github.com/volatilityfoundation/volatility)
- (1) AWS S3 Bucket
- (1) AWS VPC
- VPC Endpoints for AWS services being utilized:
    - ec2_endpoint
    - ec2_msg_endpoint
    - kms_endpoint
    - ssm_endpoint
    - ssm_msg_endpoint
    - s3_endpoint
- (1) Security Group for the EC2 instance provisioned during the automation

Supported OS:
- Amazon Linux 2

## Build

To build this app, you need to be in the project root folder. Then run the following:

    $ npm install -g aws-cdk
    <installs AWS CDK>

    $ npm install
    <installs appropriate packages>

    $ npm run build
    <build TypeScript files>

## Deploy

    $ cdk bootstrap aws://<INSERT_AWS_ACCOUNT>/<INSERT_REGION>
    <build S3 bucket to store files to perform deployment>

    $ cdk deploy
    <deploys the cdk project into the authenticated AWS account>

## How to Use

Once you have deployed the solution, you can build modules by leveraging the Step Function.

1. Go to the AWS account where the solution was deployed
2. Select the step function `create_ec2_volatile_memory_modules`
3. Start an execution and pass the following:
    {
    "AMI_ID": "INSERT AMI-ID",
    "kernelversion": "INSERT KERNEL VERSION"
    }

Example values:

    {
    "AMI_ID": "ami-0022f774911c1d690",
    "kernelversion":"kernel-4.14.104-95.84.amzn2.x86_64"
    }

Note: kernelversion is optional and only required if you are trying to build modules for a specific kernel version. If no value is provided, the default kernel version on the AMI-ID will be utilized.

## CDK Toolkit

The [`cdk.json`](./cdk.json) file in the root of this repository includes
instructions for the CDK toolkit on how to execute this program.

After building your TypeScript code, you will be able to run the CDK toolkits commands as usual:

    $ cdk ls
    <list all stacks in this program>

    $ cdk synth
    <generates and outputs cloudformation template>

    $ cdk deploy
    <deploys stack to your account>

    $ cdk diff
    <shows diff against deployed stack>

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.

