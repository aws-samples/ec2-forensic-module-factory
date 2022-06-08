import { CfnParameter, Stack, StackProps, Duration, RemovalPolicy, Fn } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Key } from 'aws-cdk-lib/aws-kms';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership, StorageClass } from 'aws-cdk-lib/aws-s3';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { join } from 'path';
import { CfnDocument, StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Choice, Condition, Fail, StateMachine, Succeed, IntegrationPattern, JsonPath, TaskInput, LogLevel } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"; 


export class Ec2VolModules extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // KMS Key for S3 Bucket resources
    const s3_kms_key = new Key(this, 's3_kms_key', {
      removalPolicy: RemovalPolicy.DESTROY,
      pendingWindow: Duration.days(7),
      description: 'KMS key for modules in S3 bucket.',
      enableKeyRotation: true,
      alias: 'ec2_module_key'
    });

    const cw_kms_key = new Key(this, 'cw_kms_key', {
      removalPolicy: RemovalPolicy.DESTROY,
      pendingWindow: Duration.days(7),
      description: 'KMS key for cloudwatch logs.',
      enableKeyRotation: true,
      alias: 'cloudwatch_key'
    });

    // VPC for Lambda Function
    const cw_step_function_logs_parameter = new CfnParameter(this, 'cw_step_function_logs_parameter', {
      type: 'String',
      description: 'The cloudwatch log group name for step function.',
      default: '/aws/statemachine/ec2'
    });

    const cw_vpc_flow_logs_parameter = new CfnParameter(this, 'cw_flow_logs_parameter', {
      type: 'String',
      description: 'The cloudwatch log group name for VPC flow logs AMI.',
      default: '/aws/vpc/flowlogs'
    });

    const cw_flow_logs = new LogGroup(this, 'cw_flow_logs', {
      logGroupName: cw_vpc_flow_logs_parameter.valueAsString,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_YEAR
      });

    const ec2_automation_vpc = new ec2.Vpc(this, 'ec2_automation_vpc', {
      natGateways: 1,
      cidr: '10.0.0.0/16',
      maxAzs: 2,
      subnetConfiguration: [
        {cidrMask: 28,
        name: 'maintenance_public_subnet',
        subnetType: ec2.SubnetType.PUBLIC},
        {cidrMask: 28,
        name: 'maintenance_private_iso_subnet',
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED},
        {cidrMask: 24,
        name: 'maintenance_private_nat_subnet',
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT},
      ],
      flowLogs: {
        's3': {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(cw_flow_logs),
          trafficType: ec2.FlowLogTrafficType.ALL,
      }}
    });

    const ec2_workload_sg = new ec2.SecurityGroup(this, 'ec2_workload_sg', {
      vpc: ec2_automation_vpc,
      description: 'Lambda Workload SG',
      allowAllOutbound: false,
      securityGroupName: 'ec2_workload_sg'
    });

    ec2_workload_sg.connections.allowTo(ec2_workload_sg, ec2.Port.tcp(443), 'Allow HTTPS Outbound for PrivateLink')
    ec2_workload_sg.connections.allowFrom(ec2_workload_sg, ec2.Port.tcp(443), 'Allow HTTPS Inbound for PrivateLink')
    ec2_workload_sg.connections.allowTo(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS Outbound for Egress internet connectivity')


    ec2_automation_vpc.addInterfaceEndpoint('ec2_endpoint',{
      service: ec2.InterfaceVpcEndpointAwsService.EC2,
      privateDnsEnabled: true,
      subnets: {
         subnets: [
          ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnets[0]
         ]
      },
      securityGroups: (
        [ec2_workload_sg]
      )
    });

    ec2_automation_vpc.addInterfaceEndpoint('ec2_msg_endpoint',{
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      privateDnsEnabled: true,
      subnets: {
         subnets: [
          ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnets[0]
         ]
      },
      securityGroups: (
        [ec2_workload_sg]
      )
    });

    ec2_automation_vpc.addInterfaceEndpoint('kms_endpoint',{
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
      privateDnsEnabled: true,
      subnets: {
         subnets: [
          ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnets[0]
         ]
      },
      securityGroups: (
        [ec2_workload_sg]
      )
    });

    ec2_automation_vpc.addInterfaceEndpoint('ssm_endpoint',{
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      privateDnsEnabled: true,
      subnets: {
         subnets: [
          ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnets[0]
         ]
      },
      securityGroups: (
        [ec2_workload_sg]
      )
    });

    ec2_automation_vpc.addInterfaceEndpoint('ssm_msg_endpoint',{
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      privateDnsEnabled: true,
      subnets: {
         subnets: [
          ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnets[0]
         ]
      },
      securityGroups: (
        [ec2_workload_sg]
      )
    });

    ec2_automation_vpc.addInterfaceEndpoint('s3_endpoint',{
      service: new ec2.InterfaceVpcEndpointService('com.amazonaws.us-east-1.s3', 443),
      subnets: {
         subnets: [
          ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnets[0]
         ]
      },
      securityGroups: (
        [ec2_workload_sg]
      )
    });

    // S3 Bucket for Security Hub Export
    const ec2_module_bucket = new Bucket(this, 'ec2_module_bucket', {
      removalPolicy: RemovalPolicy.RETAIN,
      bucketKeyEnabled: true,
      encryption: BucketEncryption.KMS,
      encryptionKey: s3_kms_key,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      publicReadAccess: false,
      lifecycleRules: [{
        expiration: Duration.days(365),
        transitions: [{
            storageClass: StorageClass.GLACIER,
            transitionAfter: Duration.days(31)
        }]
    }]
    });


    // SSM Document for EC2 Module Creation
    const ssm_document_name = 'ec2_forensic_module_build-2'
    const ec2_module_document = new CfnDocument(this, 'ec2_module_document', {
      documentType: 'Command',
      name: ssm_document_name,
      content: {
        "schemaVersion": "2.2",
        "description": "Create modules for EC2 forensics and investigation.",
        "parameters": {
          "s3bucket": {
              "type": "String",
              "description": "(Required) S3 bucket details where modules are copied."
          },
          "kernelversion": {
            "type": "String",
            "description": "(Required) Kernel version to create modules for.",
            "default": "uname -r"
        },
          "ExecutionTimeout": {
              "type": "String",
              "description": "(Required) SSM document execution timeout(seconds)",
              "default": "4000"
          },
          "Region": {
            "type": "String",
            "description": "(Required) Region where automation for module build occurs.",
            "default": "us-east-1"
          },
          "EC2InstanceId": {
            "type": "String",
            "description": "(Required) EC2 instance where module build occurs."
          },
          "TaskToken": {
              "type": "String",
              "description": "(Required) TaskToken from Step Function to complete task."
          }
      },
        "mainSteps": [
          {
              "action": "aws:runShellScript",
              "name": "createEC2kernelversion",
              "precondition": {
                  "StringEquals": ["platformType", "Linux"]
              },
              "inputs": {
                  "timeoutSeconds": "{{ ExecutionTimeout }}",
                  "runCommand": [
                    // Get Kernel OS version
                      "kernel_release={{ kernelversion }}",
                      "sudo su",
                      "#!/bin/bash",
                      "sudo yum install $kernel_release -y",
                    // Restart node if required
                      "needs-restarting -r",
                      "if [ $? -eq 1 ]",
                      "then",
                      "        exit 194",
                      "else",
                      "        echo $kernel_release will be used to create modules.",
                      "fi",
                    // Prepare and Update EC2
                      "kernel_release={{ kernelversion }}",
                      "sudo su",
                      "#!/bin/bash",
                      "cd /tmp",
                      "sudo yum install git -y",
                      "if [ `rpm -qa|grep awscli|wc -l` -eq 0 ]; then yum -y install awscli; fi",
                      "if [ `lsmod|grep lime|wc -l` -gt 0 ]; then rmmod lime; fi",
                      "yum install git -y",
                      "yum install python3 -y",
                      //"curl -O https://bootstrap.pypa.io/pip/3.6/get-pip.py",
                      "yum install pip -y",
                      //"python3 get-pip.py",
                    // Dependencies for Volatility2
                      "sudo su",
                      "sudo pip install pycrypto",
                      "sudo pip install distorm3",
                      "echo $kernel_release",
                      "sudo yum install kernel-devel-$kernel_release -y",
                      "sudo yum install gcc -y",
                      "sudo yum install libdwarf-tools -y",                  
                    // LiME module creation
                      "git clone https://github.com/504ensicsLabs/LiME",
                      "sudo zip -r LiME.zip LiME",
                      "cd LiME",
                      "cd src",
                      "sudo make",
                      "aws configure set default.s3.max_concurrent_requests 20",
                      "aws s3 cp lime-$kernel_release.ko s3://{{ s3bucket }}/tools/LiME/",
                      "echo LiME module creation completed for $kernel_release",
                      "cd /tmp",
                    // Volatility profile creation
                      "git clone https://github.com/volatilityfoundation/volatility.git",
                      "cd volatility/tools/linux",
                      "sudo make",
                      "sudo zip /tmp/volatility/volatility/plugins/overlays/linux/$kernel_release.zip /tmp/volatility/tools/linux/module.dwarf /boot/System.map-$kernel_release",
                      "aws s3 cp /tmp/volatility/volatility/plugins/overlays/linux/$kernel_release.zip s3://{{ s3bucket }}/tools/vol2/",
                      "echo Volatility2 profile creation completed for $kernel_release",
                      "ls -ltr",
                    // Send Step Function task token to end task
                      'cat <<EOF >> ec2_module_steptoken.json',
                      '{',
                      '"taskToken":"{{ TaskToken }}",',
                      '"output":"{\\"InstanceId\\": \\"{{ EC2InstanceId }}\\"}"',
                      '}',
                      'EOF',
                      'aws stepfunctions send-task-success --cli-input-json file://ec2_module_steptoken.json --region {{ Region }}',                      
                      "exit 0;"
                  ]
              }
          }
      ]
      } 
    });
  
    // EC2 Launch Lambda Function Resources 
    const lambda_create_ec2_module_role = new iam.Role(this, 'lambda_create_ec2_module_role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: "LambdaEC2ModuleCreationRole",
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'lambdaEC2LaunchExecutionPolicy', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // EC2 Launch IAM role 
    const ec2_instance_module_role = new iam.Role(this, 'ec2_instance_module_role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      roleName: "EC2InstanceRole",
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'lambdaEC2InstanceExecutionPolicy', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    const ec2_instance_profile_role = new iam.CfnInstanceProfile(this, 'EC2InstanceProfile', {
      roles: [ec2_instance_module_role.roleName],
      instanceProfileName: 'EC2InstanceProfile',
    });

    const create_ec2_instance_profile_policy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: "KMSUse",
          effect: iam.Effect.ALLOW,
          actions: [
            "kms:Describe*",
            "kms:Decrypt",
            "kms:Encrypt",
            "kms:GenerateDataKey"
          ],
          resources: [
            s3_kms_key.keyArn
          ]   
        }),
        new iam.PolicyStatement({
          sid: "EC2Allow",
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:CreateNetworkInterface",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DeleteNetworkInterface"
          ],
          resources: [
            "*",
          ]   
        }),
        new iam.PolicyStatement({
          sid: "StepFunctionAllow",
          effect: iam.Effect.ALLOW,
          actions: [
            "states:SendTaskSuccess"
          ],
          resources: [
            "*",
          ]   
        }),
      ],
    });

    new iam.ManagedPolicy(this, 'EC2CreateModuleManagedPolicy', {
      description: 'EC2 Volatile Memory module instance profile.',
      document:create_ec2_instance_profile_policy,
      managedPolicyName: 'EC2ModuleInstanceManagedPolicy',
      roles: [ec2_instance_module_role]
    });

    const create_ec2_module_function = new Function(this, 'create_ec2_module_function', {
      runtime: Runtime.PYTHON_3_8,
      code: Code.fromAsset(join(__dirname, "../lambdas/create")),
      handler: 'create_modules.lambda_handler',
      description: 'Creates EC2 volatile memory modules for forensics.',
      timeout: Duration.seconds(900),
      memorySize: 1024,
      role: lambda_create_ec2_module_role,
      reservedConcurrentExecutions: 20,
      environment:{
        S3_BUCKET: ec2_module_bucket.bucketName,
        KMS_KEY_ID: s3_kms_key.keyArn,
        SECURITY_GROUP_ID:ec2_workload_sg.securityGroupId,
        SUBNET_ID: ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnetIds[0],
        INSTANCE_PROFILE: ec2_instance_profile_role.attrArn,
        REGION: this.region,
        SSM_DOC: ssm_document_name
      },
       vpc: ec2_automation_vpc,
       securityGroups: [ec2_workload_sg],
       vpcSubnets:
       {
         subnetType: ec2.SubnetType.PRIVATE_ISOLATED                                                                                                               
       }
    });

    const cleanup_ec2_module_function = new Function(this, 'cleanup_ec2_module_function', {
      runtime: Runtime.PYTHON_3_8,
      code: Code.fromAsset(join(__dirname, "../lambdas/cleanup")),
      handler: 'cleanup.lambda_handler',
      description: 'Deletes EC2 instance after memory modules for forensics are.',
      timeout: Duration.seconds(900),
      memorySize: 1024,
      role: lambda_create_ec2_module_role,
      reservedConcurrentExecutions: 20,
      environment:{
        S3_BUCKET: ec2_module_bucket.bucketName,
        KMS_KEY_ID: s3_kms_key.keyArn,
        SECURITY_GROUP_ID:ec2_workload_sg.securityGroupId,
        SUBNET_ID: ec2_automation_vpc.selectSubnets({subnetGroupName: 'maintenance_private_nat_subnet'}).subnetIds[0],
        INSTANCE_PROFILE: ec2_instance_profile_role.attrArn,
        REGION: this.region,
        SSM_DOC: ssm_document_name
      },
       vpc: ec2_automation_vpc,
       securityGroups: [ec2_workload_sg],
       vpcSubnets:
       {
         subnetType: ec2.SubnetType.PRIVATE_ISOLATED                                                                                                               
       }
    });

    const ec2_module_create = new LambdaInvoke(this, 'Create EC2 modules', {
      lambdaFunction: create_ec2_module_function,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: TaskInput.fromObject({
        token: JsonPath.taskToken,
        input: JsonPath.stringAt('$'),
      }),
    });

    const create_ec2_module_policy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: "KMSDecrypt",
          effect: iam.Effect.ALLOW,
          actions: [
            "kms:Describe*",
            "kms:Decrypt",
            "kms:GenerateDataKey"
          ],
          resources: [
            s3_kms_key.keyArn
          ]   
        }),
        new iam.PolicyStatement({
          sid: "IAMPassRole",
          effect: iam.Effect.ALLOW,
          actions: [
            "iam:PassRole"
          ],
          resources: [
            ec2_instance_module_role.roleArn
          ]   
        }),
        new iam.PolicyStatement({
          sid: "EC2Allow",
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:RunInstances",
            "ec2:Describe*",
            "ec2:CreateNetworkInterface",
            "ec2:DeleteNetworkInterface",
            "ec2:TerminateInstances"
          ],
          resources: [
            "*",
          ]   
        }),
        new iam.PolicyStatement({
          sid: "SSMExecute",
          effect: iam.Effect.ALLOW,
          actions: [
            "ssm:SendCommand"
          ],
          resources: [
            "*"
          ]   
        })
      ],
    });

    new iam.ManagedPolicy(this, 'lambdaCreateEC2moduleManagedPolicy', {
      description: 'Create EC2 Volatile Memory modules.',
      document:create_ec2_module_policy,
      managedPolicyName: 'lambdaCreateEC2ModuleManagedPolicy',
      roles: [lambda_create_ec2_module_role]
    });

    ec2_module_bucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject*',
        's3:ListBucket',
        's3:PutObject*'
      ],
      resources: [
        ec2_module_bucket.bucketArn,
        ec2_module_bucket.arnForObjects('*')
      ],
      principals: [
        new iam.ArnPrincipal(lambda_create_ec2_module_role.roleArn),
        new iam.ArnPrincipal(ec2_instance_module_role.roleArn)
      ]
    }));

    // Step Function State Machine for orchestrating Security Hub export lambda
    const create_ec2_module_task = new LambdaInvoke(this, "CreateEC2Modules", {
      lambdaFunction: create_ec2_module_function,
      inputPath: '$',
      outputPath: '$',
    })

    ec2_module_create.addRetry({
      errors:['States.ALL'],
      maxAttempts: 5,
      backoffRate: 2,
      interval: Duration.seconds(10),
    })

    const cleanup_ec2_module_task = new LambdaInvoke(this, "Cleanup EC2 Build Resources.", {
      lambdaFunction: cleanup_ec2_module_function,
      inputPath: '$',
      outputPath: '$',
    })

    const definition = 
    ec2_module_create
    .next(cleanup_ec2_module_task)

    const state_machine_logs = new LogGroup(this, 'state_machine_logs',{
      logGroupName: cw_step_function_logs_parameter.valueAsString,
//      encryptionKey: cw_kms_key,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_YEAR
    });

    const ec2_volatile_memory_modules_machine = new StateMachine(this, "ec2_volatile_memory_modules_machine", {
      definition,
      stateMachineName: 'create_ec2_volatile_memory_modules'
    });

  }
}
